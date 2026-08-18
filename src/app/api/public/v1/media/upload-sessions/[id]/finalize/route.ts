import crypto from 'crypto';
import sharp from 'sharp';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import {
  type PublicMediaAsset,
  validatePublicMediaUpload,
} from '@/lib/public-api/media';
import { publicApiError } from '@/lib/public-api/response';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { buildDownloadUrl } from '@/lib/storage';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const FINALIZE_LEASE_MS = 5 * 60 * 1000;

type PublicUploadSession = {
  purpose?: string;
  assetId?: string;
  storagePath?: string;
  finalStoragePath?: string;
  expectedName?: string;
  expectedType?: string;
  expectedSize?: number;
  mediaType?: 'image' | 'video';
  createdByType?: string;
  createdById?: string;
  createdAt?: string;
  status?: string;
  expiresAt?: Timestamp | Date | string;
  finalizeLeaseUntil?: Timestamp | Date | string;
  result?: { asset?: PublicMediaAsset };
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let reservedQuota: { uid: string; workspaceId: string } | null = null;
  let claimedSessionRef: FirebaseFirestore.DocumentReference | null = null;
  let sessionRejected = false;
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });
    const { id: assetId } = await params;
    if (!/^ast_[a-f0-9-]{36}$/.test(assetId)) {
      throw new Error('VALIDATION_INVALID_UPLOAD_SESSION');
    }

    const sessionRef = adminDb.doc(`workspaces/${ctx.workspaceId}/upload_sessions/${assetId}`);
    const claim = await adminDb.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) throw new Error('NOT_FOUND');
      const session = sessionSnap.data() as PublicUploadSession;
      if (
        session.purpose !== 'public_api_media'
        || session.assetId !== assetId
        || session.createdByType !== ctx.principalType
        || session.createdById !== ctx.clientId
        || !session.storagePath
        || !session.finalStoragePath
      ) {
        throw new Error('NOT_FOUND');
      }
      if (session.status === 'completed' && session.result?.asset) {
        return { state: 'completed' as const, session };
      }
      if (
        session.status === 'rejected'
        || (millis(session.expiresAt) && millis(session.expiresAt) <= Date.now())
      ) {
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
      return Response.json(
        { asset: claim.session.result?.asset },
        { status: 200, headers: ctx.rateLimitHeaders },
      );
    }
    if (claim.state === 'in_progress') {
      return Response.json(
        { error: 'UPLOAD_FINALIZATION_IN_PROGRESS' },
        { status: 409, headers: ctx.rateLimitHeaders },
      );
    }

    const session = claim.session;
    claimedSessionRef = sessionRef;
    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const stagedFile = bucket.file(session.storagePath!);
    const finalFile = bucket.file(session.finalStoragePath!);
    let file = stagedFile;
    let isStaged = true;
    let metadata;
    try {
      [metadata] = await stagedFile.getMetadata();
    } catch (error) {
      if (!isStorageNotFound(error)) throw error;
      [metadata] = await finalFile.getMetadata();
      file = finalFile;
      isStaged = false;
    }

    const actualType = String(metadata.contentType || '');
    const actualSize = Number(metadata.size || 0);
    let mediaType: 'image' | 'video';
    try {
      mediaType = validatePublicMediaUpload(actualType, actualSize);
      if (actualType !== session.expectedType || actualSize !== Number(session.expectedSize)) {
        throw new Error('VALIDATION_UPLOAD_METADATA_MISMATCH');
      }
    } catch (error) {
      await file.delete({ ignoreNotFound: true });
      await sessionRef.set({
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        finalizeLeaseUntil: FieldValue.delete(),
      }, { merge: true });
      sessionRejected = true;
      throw error;
    }

    let width: number | null = null;
    let height: number | null = null;
    if (mediaType === 'image') {
      const [imageBuffer] = await file.download();
      const imageMetadata = await sharp(imageBuffer, { animated: true }).metadata();
      width = imageMetadata.width ?? null;
      height = imageMetadata.height ?? null;
    }

    const quotaUid = ctx.ownerUid ?? '';
    const quota = await checkAndIncrementUsage(quotaUid, 'mediaUploads', ctx.workspaceId);
    if (!quota.allowed) {
      await sessionRef.set({
        status: 'pending',
        finalizeLeaseUntil: FieldValue.delete(),
      }, { merge: true });
      claimedSessionRef = null;
      return Response.json({
        error: quota.reason === 'subscription_required'
          ? 'SUBSCRIPTION_REQUIRED'
          : 'QUOTA_EXCEEDED_MEDIA_UPLOADS',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedQuota = { uid: quotaUid, workspaceId: ctx.workspaceId };

    if (isStaged) {
      await stagedFile.move(session.finalStoragePath!);
      file = finalFile;
    }

    const createdAt = session.createdAt || new Date().toISOString();
    const downloadToken = crypto.randomUUID();
    await file.setMetadata({
      contentType: actualType,
      metadata: {
        workspaceId: ctx.workspaceId,
        createdByType: ctx.principalType,
        createdById: ctx.clientId,
        createdAt,
        originalFileName: session.expectedName || assetId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    });
    const downloadUrl = buildDownloadUrl(bucket.name, session.finalStoragePath!, downloadToken);
    const asset: PublicMediaAsset = {
      id: assetId,
      type: mediaType,
      storagePath: session.finalStoragePath!,
      downloadUrl,
      mimeType: actualType,
      sizeBytes: actualSize,
      width,
      height,
      originalFileName: session.expectedName || assetId,
      createdByType: ctx.principalType,
      createdById: ctx.clientId,
      createdAt,
    };

    const batch = adminDb.batch();
    batch.set(adminDb.doc(`workspaces/${ctx.workspaceId}/media_assets/${assetId}`), asset);
    batch.set(sessionRef, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: { asset },
      finalizeLeaseUntil: FieldValue.delete(),
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_RETENTION_MS),
    }, { merge: true });
    await batch.commit();
    reservedQuota = null;
    claimedSessionRef = null;
    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'media_upload').catch(() => undefined);

    return Response.json({ asset }, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    if (reservedQuota) {
      await refundUsage(reservedQuota.uid, 'mediaUploads', 1, reservedQuota.workspaceId);
    }
    if (claimedSessionRef && !sessionRejected) {
      await claimedSessionRef.set({
        status: 'pending',
        finalizeLeaseUntil: FieldValue.delete(),
      }, { merge: true }).catch(() => undefined);
    }
    return publicApiError(error);
  }
}
