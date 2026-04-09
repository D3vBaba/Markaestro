import { requirePublicApiContext } from '@/lib/public-api/auth';
import { getPublicPost, serializePublicPost } from '@/lib/public-api/posts';
import { publicApiError } from '@/lib/public-api/response';

const POSTS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.read',
      rateLimit: POSTS_RATE_LIMIT,
    });
    const { id } = await params;
    const post = await getPublicPost(ctx.workspaceId, id);
    return Response.json({ post: serializePublicPost(post) }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
