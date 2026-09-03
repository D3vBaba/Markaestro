import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createEvergreenQueueSchema } from '@/lib/evergreen/schemas';
import { createEvergreenQueue, listEvergreenQueues } from '@/lib/evergreen/storage';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';

const EVERGREEN_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'evergreen.read',
      rateLimit: EVERGREEN_RATE_LIMIT,
    });
    const queues = await listEvergreenQueues(ctx.workspaceId, ctx.productId);
    return Response.json({ queues, count: queues.length }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'evergreen.write',
      rateLimit: EVERGREEN_RATE_LIMIT,
    });
    const raw = await req.json();
    if (raw && typeof raw === 'object' && 'productId' in raw) {
      const requestedProductId = (raw as { productId?: unknown }).productId;
      if (requestedProductId !== undefined && requestedProductId !== ctx.productId) {
        throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
      }
    }
    const input = createEvergreenQueueSchema.parse({
      ...(raw && typeof raw === 'object' ? raw : {}),
      productId: ctx.productId,
    });
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(JSON.stringify(input)) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }
    const queue = await createEvergreenQueue(
      ctx.workspaceId,
      ctx.ownerUid || `api_client:${ctx.clientId}`,
      input,
      { testMode: ctx.mode === 'test' },
    );
    const responseBody = { queue };
    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 201, responseBody);
    }
    return Response.json(responseBody, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
