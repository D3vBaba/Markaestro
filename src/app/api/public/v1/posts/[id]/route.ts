import { requirePublicApiContext } from '@/lib/public-api/auth';
import {
  assertPublicPostDeletable,
  assertPublicPostInBrandScope,
  deletePublicPost,
  getPublicPost,
  serializePublicPost,
} from '@/lib/public-api/posts';
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
    assertPublicPostInBrandScope(post, ctx.productId);
    return Response.json({ post: serializePublicPost(post) }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

// Deleting removes the scheduled post from Markaestro. It does not retract
// anything already live on a platform — delete a published post and the
// platform copy stays up.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      // Reuses the existing posts.write scope so keys issued before delete
      // existed can call it without being reissued.
      scope: 'posts.write',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const { id } = await params;

    // A delete raced by its own retry answers NOT_FOUND on the second try,
    // which reads as a failure to a client that cannot tell "already gone"
    // from "never existed". With a key, the retry replays the original 200.
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(`DELETE:posts:${id}`) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const post = await getPublicPost(ctx.workspaceId, id);
    assertPublicPostInBrandScope(post, ctx.productId);
    assertPublicPostDeletable(post);

    await deletePublicPost(ctx.workspaceId, id);

    const responseBody = { deleted: true, id };
    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 200, responseBody);
    }
    return Response.json(responseBody, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
