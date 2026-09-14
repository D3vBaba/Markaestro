import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getEffectiveSubscription, effectiveTier } from '@/lib/stripe/subscription';
import { PLANS } from '@/lib/stripe/plans';
import { buildAnalyticsResponse } from '@/lib/analytics/query';
import { analyticsPostSources, type AnalyticsPostSource } from '@/lib/analytics/api-shape';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';

const MAX_WINDOW_DAYS = 365;

/**
 * GET /api/analytics?days=28&channel=instagram&productId=...&tz=-120
 * or ?since=2026-08-01&until=2026-08-31 for an explicit range across all available history.
 * `source=markaestro` or `source=native` narrows to posts published through
 * Markaestro or directly on the platform; without it the whole account counts.
 *
 * Every paid plan has unlimited history; custom date ranges can reach older
 * records beyond the preset selector.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');

    const url = new URL(req.url);
    const requestedDays = Math.max(1, Math.min(
      Number.parseInt(url.searchParams.get('days') || '28', 10) || 28,
      MAX_WINDOW_DAYS,
    ));
    const channelParam = url.searchParams.get('channel') || undefined;
    const channel = channelParam && (socialChannels as readonly string[]).includes(channelParam)
      ? (channelParam as SocialChannel)
      : undefined;
    const productId = url.searchParams.get('productId') || undefined;
    const sourceParam = url.searchParams.get('source') || undefined;
    const source = sourceParam && (analyticsPostSources as readonly string[]).includes(sourceParam)
      ? (sourceParam as AnalyticsPostSource)
      : undefined;
    const since = url.searchParams.get('since') || undefined;
    const until = url.searchParams.get('until') || undefined;
    const tzOffsetMinutes = Math.max(-840, Math.min(840,
      Number.parseInt(url.searchParams.get('tz') || '0', 10) || 0,
    ));

    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const tier = effectiveTier(sub);
    const maxDays = PLANS[tier].limits.analyticsWindowDays;
    const days = maxDays === -1 ? requestedDays : Math.min(requestedDays, maxDays);

    const response = await buildAnalyticsResponse({
      workspaceId: ctx.workspaceId,
      days,
      since,
      until,
      requestedDays,
      maxDays,
      tier,
      channel,
      productId,
      source,
      tzOffsetMinutes,
    });

    return apiOk(response);
  } catch (error) {
    return apiError(error);
  }
}
