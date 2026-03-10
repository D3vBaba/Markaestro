import crypto from 'crypto';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const formData = await req.formData();
    const file = formData.get('screenshot') as File | null;
    if (!file) {
      throw new Error('VALIDATION_NO_FILE_PROVIDED');
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error('VALIDATION_INVALID_FILE_TYPE');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('VALIDATION_FILE_TOO_LARGE');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const fileId = crypto.randomUUID();
    const filePath = `workspaces/${ctx.workspaceId}/screenshots/${fileId}.${ext}`;

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const gcsFile = bucket.file(filePath);

    await gcsFile.save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: {
          workspaceId: ctx.workspaceId,
          uploadedBy: ctx.uid,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    await gcsFile.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    return apiOk({ ok: true, url: publicUrl });
  } catch (error) {
    return apiError(error);
  }
}
