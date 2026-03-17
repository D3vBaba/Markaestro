import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const formData = await req.formData();
    const file = formData.get('image') as File | null;
    if (!file) throw new Error('VALIDATION_NO_FILE_PROVIDED');
    if (!ALLOWED_TYPES.has(file.type)) throw new Error('VALIDATION_INVALID_FILE_TYPE');
    if (file.size > MAX_FILE_SIZE) throw new Error('VALIDATION_FILE_TOO_LARGE');

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
    const fileId = crypto.randomUUID();
    const filePath = `workspaces/${ctx.workspaceId}/generated/${fileId}.${ext}`;

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const gcsFile = bucket.file(filePath);
    await gcsFile.save(buffer, {
      metadata: { contentType: file.type, metadata: { workspaceId: ctx.workspaceId, uploadedBy: ctx.uid, uploadedAt: new Date().toISOString() } },
    });
    await gcsFile.makePublic();

    return apiOk({ ok: true, url: `https://storage.googleapis.com/${bucket.name}/${filePath}` });
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

    const images = files
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.name))
      .map((f) => ({
        name: f.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${f.name}`,
        createdAt: String(f.metadata.timeCreated || f.metadata.updated || ''),
        size: Number(f.metadata.size || 0),
        contentType: f.metadata.contentType,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return apiOk({ images });
  } catch (error) {
    return apiError(error);
  }
}
