import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { uploadToStorage } from '@/lib/storage';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB (Meta allows up to 30MB, Google up to 5MB, TikTok up to 10MB)
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB (TikTok up to 500MB, Meta up to 4GB)
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
]);

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      throw new Error('VALIDATION_NO_FILE_PROVIDED');
    }

    const isImage = ALLOWED_IMAGE_TYPES.has(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);

    if (!isImage && !isVideo) {
      throw new Error('VALIDATION_INVALID_FILE_TYPE');
    }

    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      const limitMB = Math.round(maxSize / (1024 * 1024));
      throw new Error(`VALIDATION_FILE_TOO_LARGE_${limitMB}MB`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Determine file extension
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'video/webm': 'webm',
    };
    const ext = extMap[file.type] || 'bin';
    const fileId = crypto.randomUUID();
    const mediaType = isVideo ? 'videos' : 'images';
    const filePath = `workspaces/${ctx.workspaceId}/ad-media/${mediaType}/${fileId}.${ext}`;

    const url = await uploadToStorage(filePath, buffer, file.type, {
      workspaceId: ctx.workspaceId,
      uploadedBy: ctx.uid,
      uploadedAt: new Date().toISOString(),
      originalName: file.name,
      fileSize: String(file.size),
    });

    return apiOk({
      ok: true,
      url,
      type: isVideo ? 'video' : 'image',
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (error) {
    return apiError(error);
  }
}
