import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { reserveStorage, refundStorage } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { buildDownloadUrl } from '@/lib/storage';
import { validateMediaUpload } from '@/lib/media-upload-policy';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createMediaAssetRecord } from '@/lib/media/asset-store';
import { mediaAssetTypeForMimeType } from '@/lib/media/asset-metadata';

export const runtime = 'nodejs';

const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const FINALIZE_LEASE_MS = 5 * 60 * 1000;

type UploadSession = {
  storagePath: string;
  finalStoragePath: string;
  expectedName?: string;
  expectedType?: string;
  expectedSize?: number;
  createdBy?: string;
  status?: string;
  expiresAt?: Timestamp | Date | string;
  finalizeLeaseUntil?: Timestamp | Date | string;
  result?: { url?: string; contentType?: string };
};

function millis(value: Timestamp | Date | string | undefined): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return 0;
}

function isStorageNotFound(error: unknown): boolean {
  const candidate = error as { code?: number | string } | null;
  return candidate?.code === 404 || candidate?.code === '404';
}

export async function POST(req: Request) {
  let reservedStorage: { workspaceId: string; bytes: number } | null = null;
  let claimedSessionRef: FirebaseFirestore.DocumentReference | null = null;
  let sessionRejected = false;
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `media-finalize:${ctx.uid}:${ctx.workspaceId}` });
    const body = await req.json() as { assetId?: string };
    const assetId = String(body.assetId || '');
    if (!/^[a-f0-9-]{36}$/.test(assetId)) throw new Error('VALIDATION_INVALID_UPLOAD_SESSION');

    const sessionRef = adminDb.doc(`workspaces/${ctx.workspaceId}/upload_sessions/${assetId}`);
    const claim = await adminDb.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) throw new Error('NOT_FOUND');
      const session = sessionSnap.data() as UploadSession;
      if (session.createdBy !== ctx.uid || !session.storagePath || !session.finalStoragePath) {
        throw new Error('FORBIDDEN');
      }
      if (session.status === 'completed' && session.result?.url) {
        return { state: 'completed' as const, session };
      }
      if (session.status === 'rejected' || (millis(session.expiresAt) && millis(session.expiresAt) <= Date.now())) {
        throw new Error('VALIDATION_INVALID_UPLOAD_SESSION');
      }
      if (session.status === 'finalizing' && millis(session.finalizeLeaseUntil) > Date.now()) {
        return { state: 'in_progress' as const, session };
      }
      tx.set(sessionRef, {
        status: 'finalizing',
        finalizeLeaseUntil: Timestamp.fromMillis(Date.now() + FINALIZE_LEASE_MS),
      }, { merge: true });
      return { state: 'claimed' as const, session };
    });

    if (claim.state === 'completed') {
      return apiOk({
        ok: true,
        url: claim.session.result?.url,
        contentType: claim.session.result?.contentType,
      });
    }
    if (claim.state === 'in_progress') {
      return apiOk({ error: 'UPLOAD_FINALIZATION_IN_PROGRESS' }, 409);
    }
    const session = claim.session;
    claimedSessionRef = sessionRef;

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const stagedFile = bucket.file(session.storagePath);
    const finalFile = bucket.file(session.finalStoragePath);
    let file = stagedFile;
    let isStaged = true;
    let metadata;
    try {
      [metadata] = await stagedFile.getMetadata();
    } catch (error) {
      if (!isStorageNotFound(error)) throw error;
      // A prior attempt can move the object and fail before recording the
      // result. Retrying from the final path makes that failure recoverable.
      [metadata] = await finalFile.getMetadata();
      file = finalFile;
      isStaged = false;
    }
    const actualType = String(metadata.contentType || '');
    const actualSize = Number(metadata.size || 0);
    try {
      validateMediaUpload(actualType, actualSize);
      if (actualType !== session.expectedType || actualSize !== Number(session.expectedSize)) {
        throw new Error('VALIDATION_UPLOAD_METADATA_MISMATCH');
      }
    } catch (error) {
      await file.delete({ ignoreNotFound: true });
      await sessionRef.set({ status: 'rejected', rejectedAt: new Date().toISOString() }, { merge: true });
      sessionRejected = true;
      throw error;
    }

    // The staged object's verified byte size is what gets reserved — the
    // declared size from create-upload-url is never trusted for metering.
    const limits = await getEffectiveLimits(ctx.uid, ctx.workspaceId);
    const quota = await reserveStorage(ctx.workspaceId, actualSize, limits);
    if (!quota.allowed) {
      await sessionRef.set({
        status: 'pending',
        finalizeLeaseUntil: FieldValue.delete(),
      }, { merge: true });
      claimedSessionRef = null;
      return apiOk({ error: 'QUOTA_EXCEEDED_STORAGE' }, 402);
    }
    reservedStorage = { workspaceId: ctx.workspaceId, bytes: actualSize };

    if (isStaged) {
      await stagedFile.move(session.finalStoragePath);
      file = finalFile;
    }

    const downloadToken = crypto.randomUUID();
    await file.setMetadata({
      contentType: actualType,
      metadata: {
        workspaceId: ctx.workspaceId,
        uploadedBy: ctx.uid,
        uploadedAt: new Date().toISOString(),
        originalFileName: session.expectedName || assetId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    });
    const url = buildDownloadUrl(bucket.name, session.finalStoragePath, downloadToken);
    // Same reason as the direct upload path: without an asset record the bytes
    // reserved above can never be released. Dimensions are left null here
    // because the buffer was never in this process (the client uploaded
    // straight to storage) and re-downloading it to measure is not worth it.
    await createMediaAssetRecord(ctx.workspaceId, {
      id: `ast_${assetId}`,
      type: mediaAssetTypeForMimeType(actualType),
      storagePath: session.finalStoragePath,
      downloadUrl: url,
      mimeType: actualType,
      sizeBytes: actualSize,
      width: null,
      height: null,
      originalFileName: session.expectedName || assetId,
      createdByType: 'user',
      createdById: ctx.uid,
      createdAt: new Date().toISOString(),
    });
    await sessionRef.set({
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: { url, contentType: actualType },
      finalizeLeaseUntil: FieldValue.delete(),
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_RETENTION_MS),
    }, { merge: true });
    reservedStorage = null;
    claimedSessionRef = null;
    return apiOk({ ok: true, url, contentType: actualType });
  } catch (error) {
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    if (claimedSessionRef && !sessionRejected) {
      await claimedSessionRef.set({
        status: 'pending',
        finalizeLeaseUntil: FieldValue.delete(),
      }, { merge: true }).catch(() => undefined);
    }
    return apiError(error);
  }
}
