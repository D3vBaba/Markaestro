import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { uploadToStorage } from '@/lib/storage';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { checkAndIncrementUsage } from '@/lib/usage';

export const runtime = 'nodejs';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 250 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const ALL_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES]);

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `media-upload:${ctx.uid}:${ctx.workspaceId}` });

    const quota = await checkAndIncrementUsage(ctx.uid, 'mediaUploads', ctx.workspaceId);
    if (!quota.allowed) {
      return apiError(new Error('QUOTA_EXCEEDED_MEDIA_UPLOADS'));
    }

    const formData = await req.formData();
    const file = (formData.get('image') || formData.get('video') || formData.get('file')) as File | null;
    if (!file) throw new Error('VALIDATION_NO_FILE_PROVIDED');
    if (!ALL_TYPES.has(file.type)) throw new Error('VALIDATION_INVALID_FILE_TYPE');

    const isVideo = VIDEO_TYPES.has(file.type);
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) throw new Error('VALIDATION_FILE_TOO_LARGE');

    const buffer = Buffer.from(await file.arrayBuffer());

    let ext: string;
    if (isVideo) {
      ext = file.type === 'video/quicktime' ? 'mov' : file.type === 'video/webm' ? 'webm' : 'mp4';
    } else {
      ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
    }

    const fileId = crypto.randomUUID();
    const filePath = `workspaces/${ctx.workspaceId}/uploads/${fileId}.${ext}`;

    const url = await uploadToStorage(filePath, buffer, file.type, {
      workspaceId: ctx.workspaceId,
      uploadedBy: ctx.uid,
      uploadedAt: new Date().toISOString(),
    });

    return apiOk({ ok: true, url, contentType: file.type });
  } catch (error) {
    return apiError(error);
  }
}
