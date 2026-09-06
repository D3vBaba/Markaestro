import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { analyticsPostsQuerySchema } from '@/lib/public-api/analytics-schemas';
import { ANALYTICS_PUBLIC_RATE_LIMIT, loadPublicAnalyticsPosts, searchParamsObject } from '@/lib/public-api/analytics';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/analytics/posts?days=90&sort=engagements&limit=100
 *
 * Every published post of the key's brand in the window with its latest
 * metrics, one row per post, summed across the channels in scope. The JSON
 * form of the Analytics page's CSV export, sortable so an agent can ask for
 * the top performers directly instead of paging through the calendar.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'analytics.read',
      rateLimit: ANALYTICS_PUBLIC_RATE_LIMIT,
    });
    const query = analyticsPostsQuerySchema.parse(searchParamsObject(req));
    const list = await loadPublicAnalyticsPosts(ctx, query);
    return Response.json(list, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
