import type { PublicApiContext } from './auth';
import type { EvergreenQueue } from '@/lib/evergreen/types';
import { getEvergreenQueue } from '@/lib/evergreen/storage';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from './idempotency';

export const EVERGREEN_PUBLIC_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export function assertEvergreenProductScope(
  queue: Pick<EvergreenQueue, 'productId'>,
  productId: string,
) {
  if (queue.productId !== productId) {
    throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
  }
}

export async function getScopedEvergreenQueue(
  ctx: PublicApiContext,
  queueId: string,
) {
  const queue = await getEvergreenQueue(ctx.workspaceId, queueId);
  assertEvergreenProductScope(queue, ctx.productId);
  return queue;
}

export async function evergreenMutationResponse<T>(
  req: Request,
  ctx: PublicApiContext,
  input: unknown,
  mutate: () => Promise<T>,
) {
  const idempotencyKey = getIdempotencyKey(req);
  const requestHash = idempotencyKey
    ? createRequestHash(JSON.stringify({ path: new URL(req.url).pathname, input }))
    : null;
  if (idempotencyKey && requestHash) {
    const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
    if (replay) {
      Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
      return replay;
    }
  }
  const responseBody = { queue: await mutate() };
  if (idempotencyKey && requestHash) {
    await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 200, responseBody);
  }
  return Response.json(responseBody, { headers: ctx.rateLimitHeaders });
}
