import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicPost, resolvePublicPostBrandScope, serializePublicPost } from '@/lib/public-api/posts';
import { createPublicPostSchema, createPublicPostsBatchSchema, listPublicPostsSchema } from '@/lib/public-api/schemas';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { executeListQuery, type FieldFilter } from '@/lib/firestore-list-query';
import { incrementApiClientStat } from '@/lib/public-api/usage';

export const runtime = 'nodejs';


const POSTS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.read',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const url = new URL(req.url);
    const params = listPublicPostsSchema.parse({
      limit: url.searchParams.get('limit') ?? 25,
      status: url.searchParams.get('status') ?? undefined,
      productId: url.searchParams.get('productId') ?? undefined,
    });

    // A brand-bound key is always pinned to its own brand; an unbound key may
    // filter by ?productId. Applied as a query filter rather than in memory so
    // `limit` counts matching posts — filtering after the fetch could return
    // fewer (or none) while more existed.
    const brandId = resolvePublicPostBrandScope(ctx.productId, params.productId);
    const filters: FieldFilter[] = [];
    if (params.status) filters.push({ field: 'status', op: '==', value: params.status });
    if (brandId) filters.push({ field: 'productId', op: '==', value: brandId });

    const posts = await executeListQuery(
      adminDb.collection(`workspaces/${ctx.workspaceId}/posts`),
      { filters, orderByField: 'createdAt', limit: params.limit },
    );

    return Response.json({
      posts: posts.map((post) => serializePublicPost(post as Record<string, unknown>)),
      count: posts.length,
    }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.write',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const body = await req.json();
    const isBatch = body && typeof body === 'object' && Array.isArray((body as { posts?: unknown }).posts);

    if (isBatch) {
      const { posts: items } = createPublicPostsBatchSchema.parse(body);
      const idempotencyKey = getIdempotencyKey(req);
      const requestHash = idempotencyKey ? createRequestHash(JSON.stringify(items)) : null;

      if (idempotencyKey && requestHash) {
        const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
        if (replay) {
          Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
          return replay;
        }
      }

      // Create posts sequentially so a failure on item N doesn't race quota
      // accounting or destination resolution with item N+1. Per-item errors
      // are surfaced in the response — the HTTP call itself stays 2xx as
      // long as the request was authenticated and well-formed.
      const results: Array<
        | { ok: true; post: ReturnType<typeof serializePublicPost> }
        | { ok: false; error: string }
      > = [];
      let createdCount = 0;
      for (const item of items) {
        try {
          const post = await createPublicPost(ctx, item);
          results.push({ ok: true, post: serializePublicPost(post as Record<string, unknown>) });
          createdCount += 1;
        } catch (e) {
          results.push({ ok: false, error: e instanceof Error ? e.message : 'UNKNOWN_ERROR' });
        }
      }
      if (createdCount > 0) {
        await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'post_create');
      }

      const responseBody = { results, created: createdCount, total: items.length };
      // Batch endpoint always returns 200; individual items signal success/failure.
      if (idempotencyKey && requestHash) {
        await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 200, responseBody);
      }
      return Response.json(responseBody, { status: 200, headers: ctx.rateLimitHeaders });
    }

    const data = createPublicPostSchema.parse(body);
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(JSON.stringify(data)) : null;

    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const post = await createPublicPost(ctx, data);
    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'post_create');
    const responseBody = { post: serializePublicPost(post as Record<string, unknown>) };

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 201, responseBody);
    }

    return Response.json(responseBody, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
