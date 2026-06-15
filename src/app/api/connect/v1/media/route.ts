// Connect API: GET /api/connect/v1/media
// Clients may call this to resolve post thumbnails, but the posts list already
// embeds media urls directly, so this is a best-effort no-op that returns an
// empty set. (Clients treat failures here as non-fatal.)
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
