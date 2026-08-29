import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { uploadToStorage } from '@/lib/storage';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { reserveStorage, refundStorage } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { MEDIA_UPLOAD_TYPES, validateMediaUpload } from '@/lib/media-upload-policy';
import { logger } from '@/lib/logger';
import { createMediaAssetRecord, serializeMediaAsset } from '@/lib/media/asset-store';
import { mediaAssetTypeForMimeType, readImageDimensions } from '@/lib/media/asset-metadata';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let reservedStorage: { workspaceId: string; bytes: number } | null = null;
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `media-upload:${ctx.uid}:${ctx.workspaceId}` });

    const formData = await req.formData();
    const file = (formData.get('image') || formData.get('video') || formData.get('file')) as File | null;
    if (!file) throw new Error('VALIDATION_NO_FILE_PROVIDED');
    if (!MEDIA_UPLOAD_TYPES.has(file.type)) throw new Error('VALIDATION_INVALID_FILE_TYPE');
    const { extension: ext } = validateMediaUpload(file.type, file.size);

    // Invalid files should not create a usage transaction only to refund it.
    const limits = await getEffectiveLimits(ctx.uid, ctx.workspaceId);
    const quota = await reserveStorage(ctx.workspaceId, file.size, limits);
    if (!quota.allowed) {
      logger.warn('media upload blocked', {
        event: 'media.upload.blocked',
        workspaceId: ctx.workspaceId,
        reason: quota.reason ?? 'quota_exceeded',
        currentBytes: quota.currentBytes,
        limitBytes: quota.limitBytes,
      });
      return apiError(new Error('QUOTA_EXCEEDED_STORAGE'));
    }
    reservedStorage = { workspaceId: ctx.workspaceId, bytes: file.size };

    const buffer = Buffer.from(await file.arrayBuffer());

    const fileId = crypto.randomUUID();
    const filePath = `workspaces/${ctx.workspaceId}/uploads/${fileId}.${ext}`;

    const uploadedAt = new Date().toISOString();
    const url = await uploadToStorage(filePath, buffer, file.type, {
      workspaceId: ctx.workspaceId,
      uploadedBy: ctx.uid,
      uploadedAt,
    });

    // Record the asset so it can be listed and, crucially, deleted. Without
    // this document the bytes reserved above could never be released, and the
    // workspace's storage counter only ever grew.
    const dimensions = await readImageDimensions(buffer, file.type);
    const asset = await createMediaAssetRecord(ctx.workspaceId, {
      id: `ast_${fileId}`,
      type: mediaAssetTypeForMimeType(file.type),
      storagePath: filePath,
      downloadUrl: url,
      mimeType: file.type,
      sizeBytes: file.size,
      width: dimensions.width,
      height: dimensions.height,
      originalFileName: file.name || `${fileId}.${ext}`,
      createdByType: 'user',
      createdById: ctx.uid,
      createdAt: uploadedAt,
    });

    reservedStorage = null;
    return apiOk({ ok: true, url, contentType: file.type, asset: serializeMediaAsset({ ...asset, id: asset.id }) });
  } catch (error) {
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    return apiError(error);
  }
}
