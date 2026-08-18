import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createMediaAsset, validatePublicMediaFile } from '@/lib/public-api/media';
import { createRequestHashParts, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { checkAndIncrementUsage, refundUsage } from '@/lib/usage';

export const runtime = 'nodejs';


const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request) {
  let reservedQuota: { uid: string; workspaceId: string } | null = null;
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new Error('VALIDATION_NO_FILE_PROVIDED');
    validatePublicMediaFile(file);

    const buffer = Buffer.from(await file.arrayBuffer());
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey
      ? createRequestHashParts([file.name, file.type, String(file.size), buffer])
      : null;

    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const quotaUid = ctx.ownerUid ?? '';
    const quota = await checkAndIncrementUsage(quotaUid, 'mediaUploads', ctx.workspaceId);
    if (!quota.allowed) {
      return Response.json({
        error: quota.reason === 'subscription_required'
          ? 'SUBSCRIPTION_REQUIRED'
          : 'QUOTA_EXCEEDED_MEDIA_UPLOADS',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedQuota = { uid: quotaUid, workspaceId: ctx.workspaceId };

    const asset = await createMediaAsset(ctx, file, buffer);
    reservedQuota = null;
    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'media_upload');
    const body = { asset: {
      id: asset.id,
      type: asset.type,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      url: asset.downloadUrl,
      createdAt: asset.createdAt,
    } };

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 201, body);
    }

    return Response.json(body, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    if (reservedQuota) {
      await refundUsage(reservedQuota.uid, 'mediaUploads', 1, reservedQuota.workspaceId);
    }
    return publicApiError(error);
  }
}
