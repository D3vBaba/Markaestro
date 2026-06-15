// Connect API: POST /api/connect/v1/analytics/sync
// No-op metrics refresh (see ../route.ts). Returns 200 so a client's "refresh"
// succeeds and then re-reads the (empty) analytics list.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    return Response.json({ ok: true }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
