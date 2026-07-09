import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiOk, apiError } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { refreshPostsNow } from '@/lib/analytics/metrics-poller';
import { recomputeDailyAggregates } from '@/lib/analytics/aggregates';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// On-demand fetch of platform insights for recent posts can be slow (several
// sequential Graph calls); allow headroom beyond the default.
export const maxDuration = 60;

/**
 * Ad-hoc "pull live data" for the Analytics page. Fetches fresh platform
 * metrics for the most recent published posts (optionally scoped to the
 * current product/channel filter), refreshes the denormalized post metrics,
 * and rebuilds the affected daily aggregates so the analytics read reflects
 * the new numbers immediately. Rate-limited per user to protect Graph quota.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    await applyRateLimit(req, RATE_LIMITS.ai, {
      key: `analytics-refresh:${ctx.uid}:${ctx.workspaceId}`,
    });

    const body = await req.json().catch(() => ({}));
    const productId =
      typeof body?.productId === 'string' && body.productId ? body.productId : undefined;
    const channel =
      typeof body?.channel === 'string' && socialChannels.includes(body.channel as SocialChannel)
        ? (body.channel as SocialChannel)
        : undefined;

    const nowIso = new Date().toISOString();
    const summary = await refreshPostsNow(ctx.workspaceId, nowIso, { productId, channel });

    if (summary.affectedDates.length) {
      await recomputeDailyAggregates(ctx.workspaceId, summary.affectedDates);
    }

    return apiOk({
      scanned: summary.due,
      updated: summary.polled,
      channelFetches: summary.channelFetches,
      errorCount: summary.errors.length,
    });
  } catch (error) {
    // applyRateLimit throws a 429 Response; pass it straight through.
    if (error instanceof Response) return error;
    return apiError(error);
  }
}
