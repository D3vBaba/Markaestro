import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { validateMediaUpload } from '@/lib/media-upload-policy';

export const runtime = 'nodejs';

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `media-upload-url:${ctx.uid}:${ctx.workspaceId}` });
    const body = await req.json() as { name?: string; type?: string; size?: number };
    const name = String(body.name || '').slice(0, 500);
    const type = String(body.type || '');
    const size = Number(body.size);
    const { extension } = validateMediaUpload(type, size);

    const assetId = crypto.randomUUID();
    // Keep unfinalized objects outside the permanent uploads prefix. A bucket
    // lifecycle rule can safely remove abandoned staging objects without ever
    // touching media that users have attached to posts.
    const storagePath = `_upload-staging/${ctx.workspaceId}/${assetId}.${extension}`;
    const finalStoragePath = `workspaces/${ctx.workspaceId}/uploads/${assetId}.${extension}`;
    const admin = await import('firebase-admin');
    const file = admin.storage().bucket().file(storagePath);
    const expiresAtMs = Date.now() + UPLOAD_URL_TTL_MS;
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAtMs,
      contentType: type,
    });

    await adminDb.doc(`workspaces/${ctx.workspaceId}/upload_sessions/${assetId}`).set({
      assetId,
      storagePath,
      finalStoragePath,
      expectedName: name,
      expectedType: type,
      expectedSize: size,
      createdBy: ctx.uid,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });

    return apiOk({ ok: true, assetId, uploadUrl, contentType: type });
  } catch (error) {
    return apiError(error);
  }
}
