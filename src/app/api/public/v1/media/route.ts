import { z } from 'zod';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { listMediaAssets, serializeMediaAsset } from '@/lib/media/asset-store';
import { publicApiError } from '@/lib/public-api/response';
import { createMediaAsset, validatePublicMediaFile } from '@/lib/public-api/media';
import { createRequestHashParts, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { reserveStorage, refundStorage } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';

export const runtime = 'nodejs';


const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(2000).optional(),
  type: z.enum(['image', 'video']).optional(),
});

/**
 * The surface had create and delete but no list, so a client that lost an
 * asset id could neither use the asset nor free the storage it was billed
 * for. Assets uploaded in the app appear here too, which is what makes the
 * listing honest rather than a view of one client's own uploads.
 */
export async function GET(req: Request) {
  try {
    // `media.write` rather than a new `media.read`: the media resource has
    // only ever had one scope, `/media/[id]` GET already uses it, and minting
    // a new scope would leave every existing key unable to call this endpoint
    // until it was rotated.
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });
    const query = listSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const page = await listMediaAssets(ctx.workspaceId, query);
    return Response.json({
      assets: page.items.map((asset) => serializeMediaAsset(asset)),
      count: page.items.length,
      nextCursor: page.nextCursor,
    }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(req: Request) {
  let reservedStorage: { workspaceId: string; bytes: number } | null = null;
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

    const limits = await getEffectiveLimits(ctx.ownerUid, ctx.workspaceId);
    const quota = await reserveStorage(ctx.workspaceId, file.size, limits);
    if (!quota.allowed) {
      return Response.json({
        error: 'QUOTA_EXCEEDED_STORAGE',
      }, { status: 402, headers: ctx.rateLimitHeaders });
    }
    reservedStorage = { workspaceId: ctx.workspaceId, bytes: file.size };

    const asset = await createMediaAsset(ctx, file, buffer);
    reservedStorage = null;
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
    if (reservedStorage) {
      await refundStorage(reservedStorage.workspaceId, reservedStorage.bytes);
    }
    return publicApiError(error);
  }
}
