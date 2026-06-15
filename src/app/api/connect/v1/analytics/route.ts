// Connect API: GET /api/connect/v1/analytics
// Markaestro does not yet pull live per-post engagement metrics from the
// platforms, so the Results tab degrades gracefully to an empty set.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    return Response.json({ data: [] }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
