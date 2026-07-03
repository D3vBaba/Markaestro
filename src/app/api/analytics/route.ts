import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS, type PlanTier } from '@/lib/stripe/plans';
import { buildAnalyticsResponse } from '@/lib/analytics/query';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';

const MAX_WINDOW_DAYS = 365;

/**
 * GET /api/analytics?days=28&channel=instagram&productId=...&tz=-120
 *
 * The history window is clamped server-side to the workspace's plan
 * (Starter 7d / Pro 90d / Business unlimited) — the UI mirrors this but the
 * API is the enforcement point.
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
    const tzOffsetMinutes = Math.max(-840, Math.min(840,
      Number.parseInt(url.searchParams.get('tz') || '0', 10) || 0,
    ));

    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const tier = (sub?.tier ?? 'starter') as PlanTier;
    const maxDays = PLANS[tier].limits.analyticsWindowDays;
    const days = maxDays === -1 ? requestedDays : Math.min(requestedDays, maxDays);

    const response = await buildAnalyticsResponse({
      workspaceId: ctx.workspaceId,
      days,
      requestedDays,
      maxDays,
      tier,
      channel,
      productId,
      tzOffsetMinutes,
    });

    return apiOk(response);
  } catch (error) {
    return apiError(error);
  }
}
