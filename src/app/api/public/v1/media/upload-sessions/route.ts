import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicMediaExtension, validatePublicMediaUpload } from '@/lib/public-api/media';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicMediaUploadSessionSchema } from '@/lib/public-api/schemas';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  let reservedQuota: { uid: string; workspaceId: string } | null = null;
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });
    const input = createPublicMediaUploadSessionSchema.parse(await req.json());
    const mediaType = validatePublicMediaUpload(input.contentType, input.sizeBytes);
    // Public upload sessions reserve quota before issuing a signed URL. This
    // prevents an authenticated client from filling staging storage with
    // abandoned 250 MB objects while bypassing the monthly media limit.
    const quotaUid = ctx.ownerUid ?? '';
    const quota = await checkAndIncrementUsage(quotaUid, 'mediaUploads', ctx.workspaceId);
    if (!quota.allowed) {
      return Response.json({
        error: quota.reason === 'subscription_required'
          ? 'SUBSCRIPTION_REQUIRED'
          : 'QUOTA_EXCEEDED_MEDIA_UPLOADS',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedQuota = { uid: quotaUid, workspaceId: ctx.workspaceId };

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
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
    reservedQuota = null;

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
    if (reservedQuota) {
      await refundUsage(reservedQuota.uid, 'mediaUploads', 1, reservedQuota.workspaceId);
    }
    return publicApiError(error);
  }
}
