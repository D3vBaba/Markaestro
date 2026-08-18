import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicMediaExtension, validatePublicMediaUpload } from '@/lib/public-api/media';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicMediaUploadSessionSchema } from '@/lib/public-api/schemas';
import { reserveStorage, refundStorage } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  let reservedStorage: { workspaceId: string; bytes: number } | null = null;
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });
    const input = createPublicMediaUploadSessionSchema.parse(await req.json());
    const mediaType = validatePublicMediaUpload(input.contentType, input.sizeBytes);
    // Public upload sessions reserve the declared bytes before issuing a
    // signed URL. This prevents an authenticated client from filling staging
    // storage with abandoned 250 MB objects while bypassing the storage cap;
    // finalize rejects any object whose actual size differs and refunds.
    const limits = await getEffectiveLimits(ctx.ownerUid, ctx.workspaceId);
    const quota = await reserveStorage(ctx.workspaceId, input.sizeBytes, limits);
    if (!quota.allowed) {
      return Response.json({
        error: 'QUOTA_EXCEEDED_STORAGE',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedStorage = { workspaceId: ctx.workspaceId, bytes: input.sizeBytes };

    const assetId = `ast_${crypto.randomUUID()}`;
    const extension = publicMediaExtension(input.contentType);
    const subdir = mediaType === 'video' ? 'videos' : 'public-media';
    const storagePath = `_upload-staging/${ctx.workspaceId}/public-api/${assetId}.${extension}`;
    const finalStoragePath = `workspaces/${ctx.workspaceId}/${subdir}/${assetId}.${extension}`;
    const expiresAtMs = Date.now() + UPLOAD_URL_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();

    const admin = await import('firebase-admin');
    const stagedFile = admin.storage().bucket().file(storagePath);
    const [uploadUrl] = await stagedFile.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAtMs,
      contentType: input.contentType,
    });

    await adminDb.doc(`workspaces/${ctx.workspaceId}/upload_sessions/${assetId}`).set({
      purpose: 'public_api_media',
      assetId,
      storagePath,
      finalStoragePath,
      expectedName: input.fileName,
      expectedType: input.contentType,
      expectedSize: input.sizeBytes,
      mediaType,
      createdByType: ctx.principalType,
      createdById: ctx.clientId,
      quotaReserved: true,
      // Bytes reserved against the storage cap, so finalize can refund
      // exactly this amount if the session is rejected. Sessions created
      // before storage metering lack the field and refund nothing.
      reservedBytes: input.sizeBytes,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
    reservedStorage = null;

    return Response.json({
      uploadSession: {
        id: assetId,
        assetId,
        uploadUrl,
        uploadMethod: 'PUT',
        uploadHeaders: { 'Content-Type': input.contentType },
        expiresAt,
      },
    }, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    return publicApiError(error);
  }
}
