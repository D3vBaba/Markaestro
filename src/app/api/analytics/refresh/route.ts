import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiOk, apiError } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { MAX_REFRESH_POSTS, refreshPostsNow } from '@/lib/analytics/metrics-poller';
import { captureAudienceSnapshots } from '@/lib/analytics/audience';
import { utcDateOf } from '@/lib/analytics/types';
import { recomputeDailyAggregates } from '@/lib/analytics/aggregates';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// On-demand fetch of platform insights for recent posts can be slow (several
// sequential Graph calls); allow headroom beyond the default.
export const maxDuration = 60;

/** Leave headroom under maxDuration for aggregates and the follower capture. */
const REFRESH_BUDGET_MS = 40_000;
const MAX_REFRESH_WINDOW_DAYS = 90;

/**
 * Ad-hoc "pull live data" for the Analytics page. Fetches fresh platform
 * metrics for the published posts in the page's current window (optionally
 * scoped to the product/channel filter), newest first, until the time budget
 * runs out; refreshes today's follower snapshots; rebuilds the affected daily
 * aggregates so the next read reflects the new numbers. Rate-limited per
 * user to protect platform quota. The response says how much of the window
 * was covered so the page never implies a full sync it did not do.
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

    const days = Math.max(1, Math.min(
      Number.parseInt(String(body?.days ?? ''), 10) || 28,
      MAX_REFRESH_WINDOW_DAYS,
    ));

    const startedMs = Date.now();
    const nowIso = new Date(startedMs).toISOString();
    const sinceIso = new Date(startedMs - days * 24 * 3600_000).toISOString();
    const summary = await refreshPostsNow(ctx.workspaceId, nowIso, {
      productId,
      channel,
      sinceIso,
      limit: MAX_REFRESH_POSTS,
      deadlineMs: startedMs + REFRESH_BUDGET_MS,
    });

    // Follower counts are otherwise a once-a-day worker job; a person pressing
    // Refresh expects today's number. Failures here are reported, not fatal.
    let followersUpdated = 0;
    const followerErrors: string[] = [];
    try {
      const audience = await captureAudienceSnapshots(ctx.workspaceId, utcDateOf(nowIso), nowIso);
      followersUpdated = audience.captured;
      followerErrors.push(...audience.errors.map((e) => `${e.channel}: ${e.error}`));
    } catch (error) {
      followerErrors.push(error instanceof Error ? error.message : 'audience capture failed');
    }

    if (summary.affectedDates.length) {
      await recomputeDailyAggregates(ctx.workspaceId, summary.affectedDates);
    }

    const errors = [...summary.errors.map((e) => e.error), ...followerErrors];
    return apiOk({
      scanned: summary.due,
      updated: summary.polled,
      remaining: summary.remaining ?? 0,
      followersUpdated,
      channelFetches: summary.channelFetches,
      errorCount: errors.length,
      firstError: errors[0] ?? null,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    // applyRateLimit throws a 429 Response; pass it straight through.
    if (error instanceof Response) return error;
    return apiError(error);
  }
}
