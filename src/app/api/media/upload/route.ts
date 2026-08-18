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

    const url = await uploadToStorage(filePath, buffer, file.type, {
      workspaceId: ctx.workspaceId,
      uploadedBy: ctx.uid,
      uploadedAt: new Date().toISOString(),
    });

    reservedStorage = null;
    return apiOk({ ok: true, url, contentType: file.type });
  } catch (error) {
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    return apiError(error);
  }
}
