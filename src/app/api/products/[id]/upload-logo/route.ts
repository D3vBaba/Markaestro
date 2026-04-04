import crypto from 'crypto';
import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    const { id } = await params;

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const formData = await req.formData();
    const file = formData.get('logo') as File | null;
    if (!file) {
      throw new Error('VALIDATION_NO_FILE_PROVIDED');
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error('VALIDATION_INVALID_FILE_TYPE');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('VALIDATION_FILE_TOO_LARGE');
    }

    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const normalized =
      file.type === 'image/svg+xml'
        ? {
            buffer: await sharp(originalBuffer).png().toBuffer(),
            contentType: 'image/png',
            ext: 'png',
          }
        : {
            buffer: originalBuffer,
            contentType: file.type,
            ext: file.type === 'image/png'
              ? 'png'
              : file.type === 'image/webp'
                ? 'webp'
                : 'jpg',
          };
    const fileId = crypto.randomUUID();
    const filePath = `workspaces/${ctx.workspaceId}/logos/${id}/${fileId}.${normalized.ext}`;

    const admin = await import('firebase-admin');
    const bucket = admin.storage().bucket();
    const gcsFile = bucket.file(filePath);

    await gcsFile.save(normalized.buffer, {
      metadata: {
        contentType: normalized.contentType,
        metadata: {
          workspaceId: ctx.workspaceId,
          productId: id,
          uploadedBy: ctx.uid,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Make the file publicly readable so the URL works without signing
    await gcsFile.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    // Update brandIdentity.logoUrl on the product
    const existing = snap.data()?.brandIdentity || {};
    await ref.update({
      brandIdentity: { ...existing, logoUrl: publicUrl },
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    });

    return apiOk({ ok: true, logoUrl: publicUrl });
  } catch (error) {
    return apiError(error);
  }
}
