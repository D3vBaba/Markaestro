import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicPost, serializePublicPost } from '@/lib/public-api/posts';
import { createPublicPostSchema, listPublicPostsSchema } from '@/lib/public-api/schemas';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { executeListQuery } from '@/lib/firestore-list-query';
import { incrementApiClientStat } from '@/lib/public-api/analytics';

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
    });

    const filters = params.status
      ? [{ field: 'status', op: '==', value: params.status } as const]
      : [];
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
