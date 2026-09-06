/**
 * The public analytics surface: the numbers the Analytics page shows, pinned
 * to the key's brand and clamped to the plan's history window.
 *
 * Nothing here computes; the loaders call the same query builders the in-app
 * routes use (`@/lib/analytics/query`, `@/lib/analytics/history`), so an
 * agent and a person looking at the same window see the same figures. What
 * this module adds is the public contract: brand pinning, the plan clamp,
 * sorting and truncation for the per-post list, and the 404-not-403 rule for
 * posts outside the key's brand.
 */

import { adminDb } from '@/lib/firebase-admin';
import { PLANS, type PlanTier } from '@/lib/stripe/plans';
import { buildAnalyticsResponse, fetchPostRowsForExport, postToRow, resolveWindow } from '@/lib/analytics/query';
import { buildPostHistory } from '@/lib/analytics/history';
import { utcDateOf, type MetricSnapshotDoc } from '@/lib/analytics/types';
import type { AnalyticsPostRow, AnalyticsResponse } from '@/lib/analytics/api-shape';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import type { PublicApiContext } from './auth';
import type { AnalyticsPostSortKey, AnalyticsPostsQuery, AnalyticsWindowQuery } from './analytics-schemas';

/**
 * Lower than the posts routes: the overview reads up to 500 post documents
 * plus the daily aggregates, and an agent polling it in a loop gains nothing
 * because metrics refresh on the poller's schedule, not per request.
 */
export const ANALYTICS_PUBLIC_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/** The subset of the key context these loaders read; narrower so tests can pass a literal. */
export type AnalyticsPrincipal = Pick<PublicApiContext, 'workspaceId' | 'productId' | 'planTier'>;

/**
 * Query strings arrive as strings; the schemas coerce. Repeated keys keep the
 * first value, which is what a caller who wrote `?days=7&days=30` least
 * expects to be surprised by.
 */
export function searchParamsObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * The plan's history window, applied the way the in-app route applies it.
 * The UI mirrors the clamp; the API is the enforcement point, and the
 * response carries `maxDays` so a client can tell a short window from a
 * short plan.
 */
export function clampAnalyticsWindow(tier: PlanTier, requestedDays: number): { maxDays: number; days: number } {
  const maxDays = PLANS[tier].limits.analyticsWindowDays;
  const days = maxDays === -1 ? requestedDays : Math.min(requestedDays, maxDays);
  return { maxDays, days };
}

export async function loadPublicAnalyticsOverview(
  principal: AnalyticsPrincipal,
  query: AnalyticsWindowQuery,
): Promise<AnalyticsResponse> {
  const { maxDays, days } = clampAnalyticsWindow(principal.planTier, query.days);
  return buildAnalyticsResponse({
    workspaceId: principal.workspaceId,
    days,
    since: query.since,
    until: query.until,
    requestedDays: query.days,
    maxDays,
    tier: principal.planTier,
    channel: query.channel,
    // A brand-bound key sees only its brand; an all-brands (sitewide) key sees
    // the whole workspace, aggregated across every brand. Passing undefined is
    // what the aggregate layer reads as workspace-wide.
    productId: principal.productId ?? undefined,
    tzOffsetMinutes: query.tz,
  });
}

/** The value a sort key reads from a row; null when the platform never reported it. */
function sortValue(row: AnalyticsPostRow, sort: AnalyticsPostSortKey): number | null {
  switch (sort) {
    case 'views': return row.views;
    case 'reach': return row.reach;
    case 'engagements': return row.engagements;
    case 'engagement_rate': return row.erByReach ?? row.erByViews;
    case 'published_at': return Date.parse(row.publishedAt) || 0;
  }
}

function recency(row: AnalyticsPostRow): number {
  return Date.parse(row.publishedAt) || 0;
}

/**
 * Descending by the sort key. A missing metric sorts after every reported
 * one (a null never outranks a zero, and never reads as one); ties and
 * missing-versus-missing fall back to newest first, then id, so the order is
 * stable across requests.
 */
export function sortAnalyticsRows(rows: AnalyticsPostRow[], sort: AnalyticsPostSortKey): AnalyticsPostRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    if (av !== null && bv !== null && av !== bv) return bv - av;
    return recency(b) - recency(a) || a.id.localeCompare(b.id);
  });
}

export type PublicAnalyticsPostList = {
  window: { days: number; since: string; until: string; maxDays: number; tier: string };
  sort: AnalyticsPostSortKey;
  posts: AnalyticsPostRow[];
  count: number;
  truncated: boolean;
};

export async function loadPublicAnalyticsPosts(
  principal: AnalyticsPrincipal,
  query: AnalyticsPostsQuery,
): Promise<PublicAnalyticsPostList> {
  const { maxDays, days } = clampAnalyticsWindow(principal.planTier, query.days);
  const window = resolveWindow({
    days,
    since: query.since,
    until: query.until,
    maxDays,
    todayUtc: utcDateOf(new Date().toISOString()),
  });
  const rows = await fetchPostRowsForExport(
    principal.workspaceId,
    `${window.sinceDate}T00:00:00.000Z`,
    query.channel,
    principal.productId ?? undefined,
  );
  // A custom range can end before today; the fetch is bounded by `since`
  // only, so drop what published after the window.
  const untilExclusive = new Date(Date.parse(`${window.untilDate}T00:00:00.000Z`) + 86_400_000).toISOString();
  const inWindow = rows.filter((row) => row.publishedAt < untilExclusive);
  const sorted = sortAnalyticsRows(inWindow, query.sort);
  return {
    window: { days: window.days, since: window.sinceDate, until: window.untilDate, maxDays, tier: principal.planTier },
    sort: query.sort,
    posts: sorted.slice(0, query.limit),
    count: Math.min(sorted.length, query.limit),
    truncated: sorted.length > query.limit,
  };
}

type HistoryPostDoc = {
  status?: string;
  productId?: string;
  testMode?: boolean;
  content?: string;
  publishedAt?: string;
  channel?: string;
  publishedChannels?: string[];
  externalUrl?: string;
  mediaUrls?: string[];
  metricsUpdatedAt?: string;
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsStatus?: string;
  metricsNextPollAt?: string;
};

export async function loadPublicPostHistory(principal: AnalyticsPrincipal, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('NOT_FOUND');
  const postRef = adminDb.doc(`workspaces/${principal.workspaceId}/posts/${id}`);
  const [postSnap, snapshots] = await Promise.all([
    postRef.get(),
    postRef.collection('metrics').orderBy('capturedAt', 'asc').limit(50).get(),
  ]);
  if (!postSnap.exists) throw new Error('NOT_FOUND');
  const post = postSnap.data() as HistoryPostDoc;
  // 404 rather than 403 outside the key's brand, so a key cannot probe for
  // ids it does not own (the same rule the posts routes follow). An all-brands
  // key (no bound brand) may read any published post in the workspace.
  // Unpublished posts have no history, and sandbox posts never earned any.
  if (
    (principal.productId && post.productId !== principal.productId) ||
    post.status !== 'published' ||
    post.testMode === true
  ) {
    throw new Error('NOT_FOUND');
  }

  const stages = buildPostHistory({
    publishedAt: post.publishedAt ?? null,
    snapshots: snapshots.docs.map((doc) => doc.data() as MetricSnapshotDoc),
    latest: post.metricsUpdatedAt && post.metricsByChannel
      ? { capturedAt: post.metricsUpdatedAt, byChannel: post.metricsByChannel }
      : null,
  });

  return {
    post: {
      id,
      content: (post.content || '').slice(0, 160),
      publishedAt: post.publishedAt ?? null,
      channels: (post.publishedChannels?.length ? post.publishedChannels : [post.channel]).filter((c): c is string => Boolean(c)),
      externalUrl: post.externalUrl ?? null,
      metricsStatus: post.metricsStatus ?? null,
      nextPollAt: post.metricsNextPollAt ?? null,
      latest: postToRow(id, post),
    },
    stages,
  };
}
