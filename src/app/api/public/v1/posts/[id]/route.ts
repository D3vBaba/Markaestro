import { requirePublicApiContext } from '@/lib/public-api/auth';
import {
  assertPublicPostDeletable,
  assertPublicPostInBrandScope,
  deletePublicPost,
  getPublicPost,
  serializePublicPost,
} from '@/lib/public-api/posts';
import { publicApiError } from '@/lib/public-api/response';

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
    const post = await getPublicPost(ctx.workspaceId, id);
    assertPublicPostInBrandScope(post, ctx.productId);
    assertPublicPostDeletable(post);

    await deletePublicPost(ctx.workspaceId, id);

    return Response.json({ deleted: true, id }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
