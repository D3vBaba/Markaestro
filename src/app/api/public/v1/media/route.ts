import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createMediaAsset } from '@/lib/public-api/media';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { incrementApiClientStat } from '@/lib/public-api/analytics';

export const runtime = 'nodejs';


const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new Error('VALIDATION_NO_FILE_PROVIDED');

    const buffer = Buffer.from(await file.arrayBuffer());
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey
      ? createRequestHash(Buffer.concat([
          Buffer.from(file.name),
          Buffer.from(file.type),
          Buffer.from(String(file.size)),
          buffer,
        ]))
      : null;

    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const asset = await createMediaAsset(ctx, file, buffer);
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
    return publicApiError(error);
  }
}
