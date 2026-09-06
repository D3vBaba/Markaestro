import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { analyticsWindowQuerySchema } from '@/lib/public-api/analytics-schemas';
import { ANALYTICS_PUBLIC_RATE_LIMIT, loadPublicAnalyticsOverview, searchParamsObject } from '@/lib/public-api/analytics';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/analytics?days=28&channel=instagram&since=&until=&tz=
 *
 * The brand's performance over a window: totals with the prior period for
 * deltas, per-channel rollups, daily series, engagement breakdown, follower
 * trend, leaderboard, posting-time heatmap, content-type averages, and the
 * computed insights. The same numbers the Analytics page shows, pinned to
 * the key's brand and clamped to the plan's history window.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'analytics.read',
      rateLimit: ANALYTICS_PUBLIC_RATE_LIMIT,
    });
    const query = analyticsWindowQuerySchema.parse(searchParamsObject(req));
    const analytics = await loadPublicAnalyticsOverview(ctx, query);
    return Response.json({ analytics }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
