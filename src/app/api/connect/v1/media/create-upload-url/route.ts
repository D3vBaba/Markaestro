// Connect API: POST /api/connect/v1/media/create-upload-url
// Mints a short-lived, single-use signed PUT url. the client then PUTs the raw
// image bytes to it (see ../upload). Returns { media_id, upload_url }.
import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { CONNECT_UPLOAD_TTL_MS, signUploadToken, requestOrigin } from '@/lib/public-api/connect-compat';
import { reserveStorage, refundStorage } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(req: Request) {
  let reservedStorage: { workspaceId: string; bytes: number } | null = null;
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });

    const body = (await req.json().catch(() => ({}))) as {
      mime_type?: string;
      size_bytes?: number;
      name?: string;
    };
    const mime = body.mime_type || 'image/png';
    // Optional declared size. Clients that omit it reserve nothing here; the
    // upload endpoint (../upload) meters the actual bytes it receives either
    // way, treating this reservation as a down payment.
    const declaredBytes = Number.isFinite(Number(body.size_bytes)) && Number(body.size_bytes) > 0
      ? Math.floor(Number(body.size_bytes))
      : 0;

    // Signed upload URLs consume the same storage quota as direct public-API
    // uploads (see /api/public/v1/media) — without this check, Connect
    // clients could mint URLs forever and bypass the plan limits entirely.
    const limits = await getEffectiveLimits(ctx.ownerUid, ctx.workspaceId);
    const quota = await reserveStorage(ctx.workspaceId, declaredBytes, limits);
    if (!quota.allowed) {
      return Response.json({
        error: 'QUOTA_EXCEEDED_STORAGE',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedStorage = { workspaceId: ctx.workspaceId, bytes: declaredBytes };

    const assetId = `ast_${crypto.randomUUID()}`;
    const token = signUploadToken({ v: 2, ws: ctx.workspaceId, assetId, mime, clientId: ctx.clientId });
    const now = Date.now();
    await adminDb.doc(`workspaces/${ctx.workspaceId}/connect_upload_sessions/${assetId}`).set({
      assetId,
      clientId: ctx.clientId,
      mime,
      reservedBytes: declaredBytes,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: Timestamp.fromMillis(now + CONNECT_UPLOAD_TTL_MS),
    });
    const upload_url = `${requestOrigin(req)}/api/connect/v1/media/upload?token=${encodeURIComponent(token)}`;

    return Response.json({ media_id: assetId, upload_url }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    return publicApiError(error);
  }
}
