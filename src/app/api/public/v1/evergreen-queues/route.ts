import { adminDb } from '@/lib/firebase-admin';
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
    const queues = await listEvergreenQueues(ctx.workspaceId, ctx.productId ?? undefined);
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
    const rawObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const requestedProductId = typeof rawObj.productId === 'string' ? rawObj.productId.trim() : undefined;
    let targetProductId: string;
    if (ctx.productId) {
      // Brand-bound key: the request may omit the brand or must name the bound one.
      if (requestedProductId && requestedProductId !== ctx.productId) {
        throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
      }
      targetProductId = ctx.productId;
    } else {
      // All-brands key: the request must name the target brand, and it must
      // belong to this workspace (the key cannot reach beyond its workspace).
      if (!requestedProductId) throw new Error('VALIDATION_PRODUCT_REQUIRED');
      const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${requestedProductId}`).get();
      if (!productSnap.exists) throw new Error('NOT_FOUND');
      targetProductId = requestedProductId;
    }
    const input = createEvergreenQueueSchema.parse({
      ...rawObj,
      productId: targetProductId,
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
