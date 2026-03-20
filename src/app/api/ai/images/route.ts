import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const ALL_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES]);

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const formData = await req.formData();
    // Accept either 'image' or 'video' field name
    const file = (formData.get('image') || formData.get('video')) as File | null;
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
    const filePath = `workspaces/${ctx.workspaceId}/generated/${fileId}.${ext}`;

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const gcsFile = bucket.file(filePath);
    await gcsFile.save(buffer, {
      metadata: { contentType: file.type, metadata: { workspaceId: ctx.workspaceId, uploadedBy: ctx.uid, uploadedAt: new Date().toISOString() } },
    });
    await gcsFile.makePublic();

    return apiOk({ ok: true, url: `https://storage.googleapis.com/${bucket.name}/${filePath}`, contentType: file.type });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/ai/images — Delete one or more files from the gallery.
 * Body: { names: string[] } — file names relative to the generated/ prefix.
 */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const names: string[] = body.names;
    if (!Array.isArray(names) || names.length === 0) throw new Error('VALIDATION_NO_FILES_SPECIFIED');
    if (names.length > 100) throw new Error('VALIDATION_TOO_MANY_FILES');

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const prefix = `workspaces/${ctx.workspaceId}/generated/`;

    let deleted = 0;
    for (const name of names) {
      // Prevent path traversal
      if (name.includes('..') || name.includes('/')) continue;
      try {
        await bucket.file(`${prefix}${name}`).delete();
        deleted++;
      } catch {
        // File may already be deleted — skip
      }
    }

    return apiOk({ ok: true, deleted });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();

    const prefix = `workspaces/${ctx.workspaceId}/generated/`;
    const [files] = await bucket.getFiles({ prefix });

    const media = files
      .filter((f) => /\.(png|jpg|jpeg|webp|mp4)$/i.test(f.name))
      .map((f) => ({
        name: f.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${f.name}`,
        createdAt: String(f.metadata.timeCreated || f.metadata.updated || ''),
        size: Number(f.metadata.size || 0),
        contentType: f.metadata.contentType,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Keep backward-compatible `images` key and add all media
    return apiOk({ images: media });
  } catch (error) {
    return apiError(error);
  }
}
