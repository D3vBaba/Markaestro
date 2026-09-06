import { requirePublicApiContext } from '@/lib/public-api/auth';
import {
  assertPublicPostInBrandScope,
  getPublicPost,
  serializePublicPost,
} from '@/lib/public-api/posts';
import { deletePublicPostById, parsePlatformFlag } from '@/lib/public-api/post-delete';
import { publicApiError } from '@/lib/public-api/response';
import {
  createRequestHash,
  getIdempotencyKey,
  loadIdempotentResponse,
  persistIdempotentResponse,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';


const POSTS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.read',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const { id } = await params;
    const post = await getPublicPost(ctx.workspaceId, id);
    assertPublicPostInBrandScope(post, ctx.productId ?? undefined);
    return Response.json({ post: serializePublicPost(post) }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

/**
 * Deleting removes the post from Markaestro. With `?platform=true` a
 * published post is also taken down from every channel it went to, and a
 * post published directly on the platform (an analytics id with
 * `source: native`) is always taken down, since that is all there is to
 * delete. See `@/lib/public-api/post-delete`.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      // Reuses the existing posts.write scope so keys issued before delete
      // existed can call it without being reissued. Taking a live post down
      // additionally needs posts.publish; the delete helper checks.
      scope: 'posts.write',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const { id } = await params;
    const platform = parsePlatformFlag(new URL(req.url).searchParams.get('platform'));

    // A delete raced by its own retry answers NOT_FOUND on the second try,
    // which reads as a failure to a client that cannot tell "already gone"
    // from "never existed". With a key, the retry replays the original 200.
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(`DELETE:posts:${id}:${platform ? 'platform' : 'record'}`) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const responseBody = await deletePublicPostById(ctx, id, { platform });

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 200, responseBody);
    }
    return Response.json(responseBody, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
