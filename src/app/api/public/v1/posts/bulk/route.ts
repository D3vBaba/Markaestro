import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { applyBulkPostOperation } from '@/lib/social/bulk-post-operations';
import { bulkPostOperationSchema } from '@/lib/social/bulk-post-schema';
import { getPublicPost, assertPublicPostInBrandScope } from '@/lib/public-api/posts';
import {
  createRequestHash,
  getIdempotencyKey,
  loadIdempotentResponse,
  persistIdempotentResponse,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';

const BULK_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/**
 * Brand-bound keys must not reach another brand's posts through a batch.
 * Filtered up front and reported per id, so a caller sees which ids their key
 * could not act on rather than a bare 403 for the whole request.
 */
async function partitionByBrandScope(
  workspaceId: string,
  ids: string[],
  keyProductId: string,
) {
  const allowed: string[] = [];
  const refused: Array<{ id: string; error: string }> = [];
  for (const id of ids) {
    try {
      assertPublicPostInBrandScope(await getPublicPost(workspaceId, id), keyProductId);
      allowed.push(id);
    } catch {
      refused.push({ id, error: 'NOT_FOUND' });
    }
  }
  return { allowed, refused };
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.write',
      rateLimit: BULK_RATE_LIMIT,
    });
    const raw = await req.text();
    const input = bulkPostOperationSchema.parse(raw ? JSON.parse(raw) : {});

    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(raw) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const { allowed, refused } = ctx.productId
      ? await partitionByBrandScope(ctx.workspaceId, input.ids, ctx.productId)
      : { allowed: input.ids, refused: [] };

    const result = await applyBulkPostOperation(ctx.workspaceId, ctx.ownerUid ?? ctx.clientId, allowed, input);
    const body = {
      succeeded: result.succeeded,
      failed: [...result.failed, ...refused],
    };
    const status = body.succeeded.length === 0 ? 400 : 200;

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, status, body);
    }

    return Response.json(body, { status, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
