import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { ANALYTICS_PUBLIC_RATE_LIMIT, loadPublicPostHistory } from '@/lib/public-api/analytics';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/analytics/posts/{id}/history
 *
 * The stage snapshots the poller stored for one post (1h, 6h, 24h, 72h, 7d,
 * 14d, 30d, 60d, 90d after publish) with the growth between stages, plus the
 * current totals. Answers 404 for anything outside the key's brand.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'analytics.read',
      rateLimit: ANALYTICS_PUBLIC_RATE_LIMIT,
    });
    const { id } = await params;
    const history = await loadPublicPostHistory(ctx, id);
    return Response.json(history, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
