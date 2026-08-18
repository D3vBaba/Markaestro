// Connect API: PUT /api/connect/v1/media/upload?token=…
// Receives raw image bytes for a single, pre-authorized asset (token minted by
// create-upload-url) and stores it as a Markaestro media_asset so it can be
// referenced when creating a post.
import sharp from 'sharp';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { uploadToStorage } from '@/lib/storage';
import { publicApiError } from '@/lib/public-api/response';
import { verifyUploadToken } from '@/lib/public-api/connect-compat';
import { PUBLIC_ALLOWED_IMAGE_TYPES, PUBLIC_MAX_IMAGE_SIZE, type PublicMediaAsset } from '@/lib/public-api/media';

export const runtime = 'nodejs';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function PUT(req: Request) {
  let claimedSessionRef: DocumentReference | null = null;
  let sessionCompleted = false;
  try {
    const url = new URL(req.url);
    const payload = verifyUploadToken(url.searchParams.get('token'));

    const mime = req.headers.get('content-type')?.split(';')[0]?.trim() || payload.mime;
    if (!PUBLIC_ALLOWED_IMAGE_TYPES.has(mime)) {
      throw new Error('VALIDATION_INVALID_FILE_TYPE');
    }
    if (payload.v === 2 && mime !== payload.mime) {
      throw new Error('VALIDATION_UPLOAD_CONTENT_TYPE_MISMATCH');
    }

    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) throw new Error('VALIDATION_NO_FILE_PROVIDED');
    if (buffer.length > PUBLIC_MAX_IMAGE_SIZE) throw new Error('VALIDATION_FILE_TOO_LARGE_10MB');

    // Version 2 upload URLs are genuinely single-use. Legacy tokens minted by
    // an older instance remain valid through their 15-minute expiry so rolling
    // deployments do not interrupt uploads already in flight.
    if (payload.v === 2) {
      const sessionRef = adminDb.doc(`workspaces/${payload.ws}/connect_upload_sessions/${payload.assetId}`);
      const now = Date.now();
      const claimed = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(sessionRef);
        if (!snap.exists) return false;
        const data = snap.data() as {
          clientId?: string;
          mime?: string;
          status?: string;
          uploadLeaseExpiresAt?: string;
        };
        if (data.clientId !== payload.clientId || data.mime !== payload.mime) return false;
        if (data.status === 'consumed') return false;
        if (data.status === 'uploading' && data.uploadLeaseExpiresAt && data.uploadLeaseExpiresAt > new Date(now).toISOString()) {
          return false;
        }
        tx.set(sessionRef, {
          status: 'uploading',
          uploadLeaseExpiresAt: new Date(now + 2 * 60_000).toISOString(),
        }, { merge: true });
        return true;
      });
      if (!claimed) throw new Error('VALIDATION_UPLOAD_URL_ALREADY_USED');
      claimedSessionRef = sessionRef;
    }

    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(buffer, { animated: true }).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // Non-fatal — dimensions are best-effort.
    }

    const ext = EXT_BY_MIME[mime] || 'png';
    const storagePath = `workspaces/${payload.ws}/public-media/${payload.assetId}.${ext}`;
    const createdAt = new Date().toISOString();
    const downloadUrl = await uploadToStorage(storagePath, buffer, mime, {
      workspaceId: payload.ws,
      createdByType: 'api_client',
      createdById: payload.clientId || 'connect',
      createdAt,
      originalFileName: `${payload.assetId}.${ext}`,
    });

    const asset: PublicMediaAsset = {
      id: payload.assetId,
      type: 'image',
      storagePath,
      downloadUrl,
      mimeType: mime,
      sizeBytes: buffer.length,
      width,
      height,
      originalFileName: `${payload.assetId}.${ext}`,
      createdByType: 'api_client',
      createdById: payload.clientId || 'connect',
      createdAt,
    };
    await adminDb.doc(`workspaces/${payload.ws}/media_assets/${payload.assetId}`).set(asset);

    if (claimedSessionRef) {
      await claimedSessionRef.set({
        status: 'consumed',
        consumedAt: createdAt,
        uploadLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      sessionCompleted = true;
    }

    return Response.json({ media_id: payload.assetId, url: downloadUrl });
  } catch (error) {
    if (claimedSessionRef && !sessionCompleted) {
      await claimedSessionRef.set({
        status: 'pending',
        uploadLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true }).catch(() => undefined);
    }
    return publicApiError(error);
  }
}
