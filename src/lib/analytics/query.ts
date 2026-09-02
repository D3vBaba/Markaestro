import { adminDb } from '@/lib/firebase-admin';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import {
  engagementTotal,
  sumAcrossChannels,
  utcDateOf,
  type AudienceSnapshotDoc,
  type ChannelDayAggregate,
  type DailyAggregateDoc,
} from './types';

import type {
  AnalyticsPostRow,
  AnalyticsResponse,
  AnalyticsTotals,
  PostContentType,
} from './api-shape';

export type { AnalyticsPostRow, AnalyticsResponse, AnalyticsTotals, PostContentType } from './api-shape';
import type { DailyPoint, EngagementBreakdown } from './api-shape';
import type { ActivityDayDoc } from './activity';

/** Bounded post scan for leaderboard/heatmap/format analysis. */
export const MAX_POSTS_ANALYZED = 500;
const LEADERBOARD_LIMIT = 50;

/** Resolve the reporting window from a preset (`days`) or an explicit range, clamped to the plan. Pure. */
export function resolveWindow(input: {
  days: number;
  since?: string;
  until?: string;
  maxDays: number;
  todayUtc: string;
}): {
  sinceDate: string;
  untilDate: string;
  days: number;
  requestedDays: number;
  priorSinceDate: string;
  priorUntilDate: string;
  custom: boolean;
} {
  const isDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
  const cap = input.maxDays === -1 ? Number.POSITIVE_INFINITY : Math.max(1, input.maxDays);
  let untilDate = input.todayUtc;
  let requestedDays = Math.max(1, Math.floor(input.days) || 1);
  let custom = false;
  if (isDate(input.since) && isDate(input.until) && input.since <= input.until) {
    custom = true;
    untilDate = input.until < input.todayUtc ? input.until : input.todayUtc;
    const span = Math.round((Date.parse(`${untilDate}T00:00:00Z`) - Date.parse(`${input.since}T00:00:00Z`)) / 86_400_000) + 1;
    requestedDays = Math.max(1, span);
  }
  const days = Math.min(requestedDays, cap);
  const sinceDate = dateNDaysAgo(untilDate, days - 1);
  return {
    sinceDate,
    untilDate,
    days,
    requestedDays,
    priorSinceDate: dateNDaysAgo(untilDate, 2 * days - 1),
    priorUntilDate: dateNDaysAgo(untilDate, days),
    custom,
  };
}

export type AnalyticsQueryOptions = {
  workspaceId: string;
  days: number;
  /** Explicit range (YYYY-MM-DD, UTC); wins over `days` when both are valid. */
  since?: string;
  until?: string;
  requestedDays: number;
  maxDays: number;
  tier: string;
  channel?: SocialChannel;
  productId?: string;
  /** Viewer timezone offset in minutes east of UTC (JS -getTimezoneOffset()). */
  tzOffsetMinutes?: number;
};

type PostDocData = {
  content?: string;
  channel?: string;
  testMode?: boolean;
  publishedChannels?: string[];
  publishedAt?: string;
  externalUrl?: string;
  productId?: string;
  mediaUrls?: string[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsUpdatedAt?: string;
};

function selectAnalyticsPostFields(query: FirebaseFirestore.Query): FirebaseFirestore.Query {
  return query.select(
    'content', 'channel', 'publishedChannels', 'publishedAt', 'externalUrl',
    'productId', 'mediaUrls', 'metricsByChannel', 'metricsUpdatedAt',
  );
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function contentTypeOf(mediaUrls: string[]): PostContentType {
  if (mediaUrls.length === 0) return 'text';
  if (mediaUrls.some(isVideoUrl)) return 'video';
  if (mediaUrls.length > 1) return 'carousel';
  return 'image';
}

function dateNDaysAgo(untilDate: string, n: number): string {
  return new Date(Date.parse(`${untilDate}T00:00:00.000Z`) - n * 24 * 3600_000).toISOString().slice(0, 10);
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function pickChannelAgg(
  doc: DailyAggregateDoc,
  channel?: SocialChannel,
  productId?: string,
): ChannelDayAggregate[] {
  // Product-filtered reads take the per-brand dimension of the same doc
  // (5.10); the caller has already verified every doc in range carries it.
  const source = productId ? doc.byProduct?.[productId]?.channels : doc.channels;
  const entries = Object.entries(source ?? {}) as Array<[SocialChannel, ChannelDayAggregate]>;
  return entries.filter(([ch]) => !channel || ch === channel).map(([, agg]) => agg);
}

export function totalsFromAggregates(
  docs: DailyAggregateDoc[],
  channel?: SocialChannel,
  productId?: string,
): AnalyticsTotals {
  let posts = 0;
  let views: number | null = null;
  let reach: number | null = null;
  let engagements: number | null = null;
  let reachForRate = 0;
  let engagementsForReachRate = 0;
  let hasReachRate = false;
  let viewsForRate = 0;
  let engagementsForViewsRate = 0;
  let hasViewsRate = false;

  for (const doc of docs) {
    for (const agg of pickChannelAgg(doc, channel, productId)) {
      posts += agg.posts;
      if (agg.postsWithViews > 0) views = (views ?? 0) + agg.views;
      if (agg.postsWithReach > 0) reach = (reach ?? 0) + agg.reach;
      if (agg.postsWithEngagements > 0) engagements = (engagements ?? 0) + agg.engagements;
      // Each rate only ever pairs engagements with the denominator the same
      // posts reported, so a channel without reach (TikTok, Threads) neither
      // inflates the reach rate nor disappears from the views rate.
      if (agg.postsWithReach > 0 && agg.postsWithEngagements > 0) {
        reachForRate += agg.reach;
        engagementsForReachRate += agg.engagements;
        hasReachRate = true;
      }
      if (agg.postsWithViews > 0 && agg.postsWithEngagements > 0) {
        viewsForRate += agg.views;
        engagementsForViewsRate += agg.engagements;
        hasViewsRate = true;
      }
    }
  }

  return {
    posts,
    views,
    reach,
    engagements,
    engagementRateByReach: hasReachRate && reachForRate > 0 ? engagementsForReachRate / reachForRate : null,
    engagementRateByViews: hasViewsRate && viewsForRate > 0 ? engagementsForViewsRate / viewsForRate : null,
  };
}

export function postToRow(id: string, post: PostDocData, channelFilter?: SocialChannel): AnalyticsPostRow {
  const byChannelAll = post.metricsByChannel ?? {};
  const byChannel: typeof byChannelAll = channelFilter
    ? (byChannelAll[channelFilter] ? { [channelFilter]: byChannelAll[channelFilter] } : {})
    : byChannelAll;

  const views = sumAcrossChannels(byChannel, (m) => m.views);
  const reach = sumAcrossChannels(byChannel, (m) => m.reach);
  const engagements = sumAcrossChannels(byChannel, (m) => engagementTotal(m));

  return {
    id,
    content: (post.content || '').slice(0, 160),
    channels: (post.publishedChannels?.length ? post.publishedChannels : [post.channel])
      .filter((c): c is SocialChannel => Boolean(c)),
    publishedAt: post.publishedAt || '',
    externalUrl: post.externalUrl || null,
    productId: post.productId || null,
    contentType: contentTypeOf(post.mediaUrls ?? []),
    views,
    reach,
    likes: sumAcrossChannels(byChannel, (m) => m.likes),
    comments: sumAcrossChannels(byChannel, (m) => m.comments),
    shares: sumAcrossChannels(byChannel, (m) => m.shares),
    saves: sumAcrossChannels(byChannel, (m) => m.saves),
    clicks: sumAcrossChannels(byChannel, (m) => m.clicks),
    engagements,
    erByReach: ratio(engagements, reach),
    erByViews: ratio(engagements, views),
  };
}

export function computeInsights(rows: AnalyticsPostRow[], tzOffsetMinutes = 0): Array<{ id: string; text: string; sampleSize: number }> {
  const insights: Array<{ id: string; text: string; sampleSize: number }> = [];
  const withEngagements = rows.filter((r) => r.engagements !== null);

  // 1. Content format comparison — needs a real sample on both sides.
  const byType = new Map<PostContentType, AnalyticsPostRow[]>();
  for (const row of withEngagements) {
    const list = byType.get(row.contentType) ?? [];
    list.push(row);
    byType.set(row.contentType, list);
  }
  const typeAverages = [...byType.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([type, list]) => ({
      type,
      posts: list.length,
      avg: list.reduce((a, r) => a + (r.engagements ?? 0), 0) / list.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  if (typeAverages.length >= 2 && withEngagements.length >= 8) {
    const [best, worst] = [typeAverages[0], typeAverages[typeAverages.length - 1]];
    if (worst.avg > 0 && best.avg / worst.avg >= 1.5) {
      insights.push({
        id: 'content-format',
        text: `${best.type === 'text' ? 'Text posts' : `${best.type[0].toUpperCase()}${best.type.slice(1)}s`} averaged ${(best.avg / worst.avg).toFixed(1)}× the engagement of ${worst.type} posts in this period.`,
        sampleSize: best.posts + worst.posts,
      });
    }
  }

  // 2. Best posting window — weekday × 4-hour band vs overall average.
  if (withEngagements.length >= 15) {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const buckets = new Map<string, { total: number; count: number }>();
    let overallTotal = 0;
    for (const row of withEngagements) {
      const d = new Date(Date.parse(row.publishedAt) + tzOffsetMinutes * 60_000);
      const day = (d.getUTCDay() + 6) % 7;
      const band = Math.floor(d.getUTCHours() / 4);
      const key = `${day}:${band}`;
      const bucket = buckets.get(key) ?? { total: 0, count: 0 };
      bucket.total += row.engagements ?? 0;
      bucket.count++;
      buckets.set(key, bucket);
      overallTotal += row.engagements ?? 0;
    }
    const overallAvg = overallTotal / withEngagements.length;
    const best = [...buckets.entries()]
      .filter(([, b]) => b.count >= 10)
      .map(([key, b]) => ({ key, avg: b.total / b.count, count: b.count }))
      .sort((a, b) => b.avg - a.avg)[0];
    if (best && overallAvg > 0 && best.avg / overallAvg >= 1.3) {
      const [day, band] = best.key.split(':').map(Number);
      insights.push({
        id: 'best-window',
        text: `Posts published ${dayNames[day]} ${band * 4}:00–${band * 4 + 4}:00 (your local time) averaged ${(best.avg / overallAvg).toFixed(1)}× your overall engagement.`,
        sampleSize: best.count,
      });
    }
  }

  // 3. Channel engagement-rate comparison.
  const byChannelRows = new Map<SocialChannel, AnalyticsPostRow[]>();
  for (const row of rows.filter((r) => r.erByReach !== null && r.channels.length === 1)) {
    const ch = row.channels[0];
    const list = byChannelRows.get(ch) ?? [];
    list.push(row);
    byChannelRows.set(ch, list);
  }
  const channelRates = [...byChannelRows.entries()]
    .filter(([, list]) => list.length >= 5)
    .map(([channel, list]) => ({
      channel,
      posts: list.length,
      er: list.reduce((a, r) => a + (r.erByReach ?? 0), 0) / list.length,
    }))
    .sort((a, b) => b.er - a.er);
  if (channelRates.length >= 2) {
    const [best, worst] = [channelRates[0], channelRates[channelRates.length - 1]];
    if (worst.er > 0 && best.er / worst.er >= 1.5) {
      insights.push({
        id: 'channel-er',
        text: `Your ${best.channel} posts earn a ${(best.er * 100).toFixed(1)}% engagement rate by reach vs ${(worst.er * 100).toFixed(1)}% on ${worst.channel}.`,
        sampleSize: best.posts + worst.posts,
      });
    }
  }

  return insights;
}

/** Sum one day's activity doc for the channel/product in scope. */
export function activitySeries(
  docs: ActivityDayDoc[],
  dates: string[],
  channel?: SocialChannel,
  productId?: string,
): DailyPoint[] {
  const byDate = new Map(docs.map((doc) => [doc.date, doc]));
  return dates.map((date) => {
    const doc = byDate.get(date);
    const point: DailyPoint = { date, views: 0, reach: 0, engagements: 0, posts: 0 };
    if (!doc) return point;
    const source = productId ? doc.byProduct?.[productId]?.channels : doc.channels;
    for (const [ch, delta] of Object.entries(source ?? {})) {
      if (channel && ch !== channel) continue;
      point.views += delta?.views ?? 0;
      point.reach += delta?.reach ?? 0;
      point.engagements += delta?.engagements ?? 0;
    }
    return point;
  });
}

export function breakdownFromAggregates(
  docs: DailyAggregateDoc[],
  channel?: SocialChannel,
  productId?: string,
): EngagementBreakdown {
  const sums = { likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 };
  let reported = 0;
  for (const doc of docs) {
    for (const agg of pickChannelAgg(doc, channel, productId)) {
      if (agg.postsWithEngagements === 0) continue;
      reported += agg.postsWithEngagements;
      sums.likes += agg.likes;
      sums.comments += agg.comments;
      sums.shares += agg.shares;
      sums.saves += agg.saves;
      sums.clicks += agg.clicks;
    }
  }
  if (reported === 0) return { likes: null, comments: null, shares: null, saves: null, clicks: null };
  return sums;
}

export function breakdownFromRows(rowList: AnalyticsPostRow[]): EngagementBreakdown {
  const sum = (pick: (row: AnalyticsPostRow) => number | null): number | null => rowList.reduce<number | null>(
    (acc, row) => { const value = pick(row); return value === null ? acc : (acc ?? 0) + value; },
    null,
  );
  return {
    likes: sum((r) => r.likes),
    comments: sum((r) => r.comments),
    shares: sum((r) => r.shares),
    saves: sum((r) => r.saves),
    clicks: sum((r) => r.clicks),
  };
}

export async function buildAnalyticsResponse(opts: AnalyticsQueryOptions): Promise<AnalyticsResponse> {
  const { workspaceId, channel, productId } = opts;
  const nowIso = new Date().toISOString();
  const window = resolveWindow({
    days: opts.days,
    since: opts.since,
    until: opts.until,
    maxDays: opts.maxDays,
    todayUtc: utcDateOf(nowIso),
  });
  const { days, sinceDate, untilDate, priorSinceDate, priorUntilDate } = window;
  const sinceIso = `${sinceDate}T00:00:00.000Z`;
  // Custom ranges can end before today; posts after the window are not rows.
  const untilIsoExclusive = new Date(Date.parse(`${untilDate}T00:00:00.000Z`) + 86_400_000).toISOString();
  // Product-filtered totals come from post rows (aggregates are workspace-
  // wide), so fetch back to the prior window to keep the comparison deltas.
  const fetchSinceIso = productId ? `${priorSinceDate}T00:00:00.000Z` : sinceIso;
  const postsBaseQuery = adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published');
  const postsQuery = selectAnalyticsPostFields(
    (productId ? postsBaseQuery.where('productId', '==', productId) : postsBaseQuery)
      .where('publishedAt', '>=', fetchSinceIso)
      .orderBy('publishedAt', 'desc')
      .limit(MAX_POSTS_ANALYZED + 1),
  );

  const [aggSnap, audienceSnap, postsSnap, activitySnap] = await Promise.all([
    adminDb
      .collection(`workspaces/${workspaceId}/analyticsDaily`)
      .where('date', '>=', priorSinceDate)
      .where('date', '<=', untilDate)
      .get(),
    adminDb
      .collection(`workspaces/${workspaceId}/audienceSnapshots`)
      .where('date', '>=', priorSinceDate)
      .get(),
    postsQuery.get(),
    adminDb
      .collection(`workspaces/${workspaceId}/analyticsActivity`)
      .where('date', '>=', sinceDate)
      .where('date', '<=', untilDate)
      .get(),
  ]);

  // ── Posts → rows (leaderboard, heatmap, content types, insights) ──
  const truncated = postsSnap.docs.length > MAX_POSTS_ANALYZED;
  const rows: AnalyticsPostRow[] = [];
  const priorRows: AnalyticsPostRow[] = [];
  let lastMetricsAt: string | null = null;
  for (const doc of postsSnap.docs.slice(0, MAX_POSTS_ANALYZED)) {
    const post = doc.data() as PostDocData;
    // Sandbox posts never reached a platform; they must not appear in any
    // leaderboard or total an integrator's test run touches.
    if (post.testMode === true) continue;
    if (productId && post.productId !== productId) continue;
    const row = postToRow(doc.id, post, channel);
    if (channel && !row.channels.includes(channel)) continue;
    if (row.publishedAt >= untilIsoExclusive) continue;
    if (row.publishedAt >= sinceIso) {
      rows.push(row);
    } else {
      priorRows.push(row);
    }
    if (post.metricsUpdatedAt && (!lastMetricsAt || post.metricsUpdatedAt > lastMetricsAt)) {
      lastMetricsAt = post.metricsUpdatedAt;
    }
  }
  const rowsWithMetrics = rows.filter((r) => r.views !== null || r.engagements !== null);

  // ── Aggregates → totals + daily series (fast path, unfiltered by product) ──
  const aggDocs = aggSnap.docs.map((d) => d.data() as DailyAggregateDoc);
  const currentAggs = aggDocs.filter((d) => d.date >= sinceDate);
  const priorAggs = aggDocs.filter((d) => d.date >= priorSinceDate && d.date <= priorUntilDate);

  // The per-brand view was the slow path: workspace-wide totals read the
  // precomputed rollups while a product filter re-derived everything from
  // post rows on each request. Rollup docs now carry a `byProduct` dimension;
  // it is used only when every doc in range has one, so a window that spans
  // the rollout boundary stays correct rather than silently under-counting
  // the older days.
  const productAggsUsable = Boolean(productId)
    && currentAggs.length > 0
    && currentAggs.every((doc) => doc.byProduct !== undefined)
    && priorAggs.every((doc) => doc.byProduct !== undefined);
  const useAggregates = !productId || productAggsUsable;
  const totalsFromRows = (list: AnalyticsPostRow[]): AnalyticsTotals => {
    const views = list.reduce<number | null>((a, r) => (r.views === null ? a : (a ?? 0) + r.views), null);
    const reach = list.reduce<number | null>((a, r) => (r.reach === null ? a : (a ?? 0) + r.reach), null);
    const engagements = list.reduce<number | null>((a, r) => (r.engagements === null ? a : (a ?? 0) + r.engagements), null);
    return {
      posts: list.length,
      views,
      reach,
      engagements,
      engagementRateByReach: ratio(engagements, reach),
      engagementRateByViews: ratio(engagements, views),
    };
  };

  const currentTotals = useAggregates ? totalsFromAggregates(currentAggs, channel, productId) : totalsFromRows(rows);
  // When the bounded fetch truncated, the prior window is incomplete — drop
  // the comparison rather than showing a delta against partial data.
  const priorTotals = useAggregates
    ? totalsFromAggregates(priorAggs, channel, productId)
    : truncated ? null : totalsFromRows(priorRows);

  const seriesFor = (dates: string[], aggs: DailyAggregateDoc[], rowList: AnalyticsPostRow[]): DailyPoint[] => dates.map((date) => {
    let views = 0, reach = 0, engagements = 0, posts = 0;
    if (useAggregates) {
      const doc = aggs.find((d) => d.date === date);
      if (doc) {
        for (const agg of pickChannelAgg(doc, channel, productId)) {
          views += agg.views;
          reach += agg.reach;
          engagements += agg.engagements;
          posts += agg.posts;
        }
      }
    } else {
      // Product-filtered view: aggregates are workspace-wide, so derive the
      // series from the (product-scoped) post rows to keep chart and totals
      // describing the same population.
      for (const row of rowList) {
        if (utcDateOf(row.publishedAt) !== date) continue;
        posts++;
        views += row.views ?? 0;
        reach += row.reach ?? 0;
        engagements += row.engagements ?? 0;
      }
    }
    return { date, views, reach, engagements, posts };
  });
  const windowDates: string[] = [];
  for (let i = days - 1; i >= 0; i--) windowDates.push(dateNDaysAgo(untilDate, i));
  const priorDates: string[] = [];
  for (let i = 2 * days - 1; i >= days; i--) priorDates.push(dateNDaysAgo(untilDate, i));
  const daily = seriesFor(windowDates, currentAggs, rows);
  // The prior series is only as complete as the prior totals: a truncated
  // product fetch would draw a comparison line against partial data.
  const priorDaily = priorTotals ? seriesFor(priorDates, priorAggs, priorRows) : [];

  // ── Activity series (what happened each day) ──────────────────────
  const activityDocs = activitySnap.docs.map((d) => d.data() as ActivityDayDoc);
  const dailyActivity = activitySeries(activityDocs, windowDates, channel, productId);

  // ── Engagement breakdown ──────────────────────────────────────────
  const breakdown = useAggregates
    ? breakdownFromAggregates(currentAggs, channel, productId)
    : breakdownFromRows(rows);
  const priorBreakdown = useAggregates
    ? breakdownFromAggregates(priorAggs, channel, productId)
    : truncated ? null : breakdownFromRows(priorRows);

  // ── Audience snapshots → follower trend + deltas ──────────────────
  const audienceDocs = audienceSnap.docs.map((d) => d.data() as AudienceSnapshotDoc)
    .filter((d) => !channel || d.channel === channel)
    .filter((d) => !productId || d.productId === productId || d.productId === null);

  // date → channel:accountKey → followers (latest snapshot per account per date)
  const followersByAccountByDate = new Map<string, Map<string, number>>();
  const accountKeys = new Set<string>();
  for (const snap of audienceDocs) {
    const key = `${snap.channel}:${snap.accountKey}`;
    accountKeys.add(key);
    const forDate = followersByAccountByDate.get(snap.date) ?? new Map<string, number>();
    forDate.set(key, snap.followers);
    followersByAccountByDate.set(snap.date, forDate);
  }

  // Carry the last known value forward so the trend has no fake dips.
  const followerTrend: AnalyticsResponse['followerTrend'] = [];
  const lastKnown = new Map<string, number>();
  const channelLatest = new Map<SocialChannel, number>();
  const channelAtWindowStart = new Map<SocialChannel, number>();
  const allDates: string[] = [];
  for (let i = 2 * days - 1; i >= 0; i--) allDates.push(dateNDaysAgo(untilDate, i));
  let followersAtWindowStart: number | null = null;

  for (const date of allDates) {
    const forDate = followersByAccountByDate.get(date);
    if (forDate) for (const [key, value] of forDate) lastKnown.set(key, value);
    if (lastKnown.size > 0 && date >= sinceDate) {
      const total = [...lastKnown.values()].reduce((a, b) => a + b, 0);
      if (followersAtWindowStart === null) {
        followersAtWindowStart = total;
        for (const [key, value] of lastKnown) {
          const ch = key.split(':')[0] as SocialChannel;
          channelAtWindowStart.set(ch, (channelAtWindowStart.get(ch) ?? 0) + value);
        }
      }
      followerTrend.push({ date, total });
    }
  }
  if (lastKnown.size > 0) {
    for (const [key, value] of lastKnown) {
      const ch = key.split(':')[0] as SocialChannel;
      channelLatest.set(ch, (channelLatest.get(ch) ?? 0) + value);
    }
  }
  const followersTotal = lastKnown.size > 0
    ? [...lastKnown.values()].reduce((a, b) => a + b, 0)
    : null;
  const followerDelta = followersTotal !== null && followersAtWindowStart !== null
    ? followersTotal - followersAtWindowStart
    : null;

  // ── Channel breakdown ─────────────────────────────────────────────
  const channelSet = new Set<SocialChannel>();
  for (const doc of currentAggs) {
    for (const ch of Object.keys(doc.channels ?? {})) channelSet.add(ch as SocialChannel);
  }
  for (const ch of channelLatest.keys()) channelSet.add(ch);
  for (const row of rows) row.channels.forEach((ch) => channelSet.add(ch));

  const channels: AnalyticsResponse['channels'] = [...channelSet]
    .filter((ch) => !channel || ch === channel)
    .map((ch) => {
      const totals = useAggregates
        ? totalsFromAggregates(currentAggs, ch, productId)
        : totalsFromRows(rows.filter((r) => r.channels.includes(ch)));
      const latest = channelLatest.get(ch) ?? null;
      const atStart = channelAtWindowStart.get(ch) ?? null;
      return {
        channel: ch,
        posts: totals.posts,
        views: totals.views,
        reach: totals.reach,
        engagements: totals.engagements,
        engagementRateByReach: totals.engagementRateByReach,
        engagementRateByViews: totals.engagementRateByViews,
        followers: latest,
        followerDelta: latest !== null && atStart !== null ? latest - atStart : null,
      };
    })
    .sort((a, b) => (b.engagements ?? -1) - (a.engagements ?? -1));

  // ── Heatmap (viewer timezone) ─────────────────────────────────────
  const tzOffsetMinutes = opts.tzOffsetMinutes ?? 0;
  const heatEngagements = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const heatPosts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let heatSample = 0;
  for (const row of rowsWithMetrics) {
    if (row.engagements === null || !row.publishedAt) continue;
    const local = new Date(Date.parse(row.publishedAt) + tzOffsetMinutes * 60_000);
    const day = (local.getUTCDay() + 6) % 7;
    const hour = local.getUTCHours();
    heatEngagements[day][hour] += row.engagements;
    heatPosts[day][hour]++;
    heatSample++;
  }

  // ── Content types ─────────────────────────────────────────────────
  const contentTypes: AnalyticsResponse['contentTypes'] = (['image', 'video', 'carousel', 'text'] as const)
    .map((type) => {
      const list = rows.filter((r) => r.contentType === type);
      const withViews = list.filter((r) => r.views !== null);
      const withEng = list.filter((r) => r.engagements !== null);
      return {
        type,
        posts: list.length,
        avgViews: withViews.length > 0
          ? withViews.reduce((a, r) => a + (r.views ?? 0), 0) / withViews.length
          : null,
        avgEngagements: withEng.length > 0
          ? withEng.reduce((a, r) => a + (r.engagements ?? 0), 0) / withEng.length
          : null,
      };
    })
    .filter((t) => t.posts > 0);

  const leaderboard = [...rowsWithMetrics]
    .sort((a, b) => (b.engagements ?? 0) - (a.engagements ?? 0))
    .slice(0, LEADERBOARD_LIMIT);

  return {
    window: {
      days,
      since: sinceDate,
      until: untilDate,
      requestedDays: window.custom ? window.requestedDays : opts.requestedDays,
      maxDays: opts.maxDays,
      tier: opts.tier,
      custom: window.custom,
      priorSince: priorSinceDate,
      priorUntil: priorUntilDate,
    },
    totals: {
      ...currentTotals,
      followers: followersTotal,
      followerDelta,
      prior: priorTotals ? { ...priorTotals, followerDelta: null } : null,
    },
    daily,
    priorDaily,
    dailyActivity,
    breakdown: { ...breakdown, prior: priorBreakdown },
    followerTrend,
    channels,
    leaderboard,
    heatmap: {
      engagements: heatEngagements,
      posts: heatPosts,
      sampleSize: heatSample,
      tzOffsetMinutes,
    },
    contentTypes,
    insights: computeInsights(rows, opts.tzOffsetMinutes ?? 0),
    coverage: {
      postsAnalyzed: rows.length,
      postsWithMetrics: rowsWithMetrics.length,
      truncated,
      lastMetricsAt,
    },
  };
}

/** The per-post rows for CSV export (unbounded window already plan-clamped). */
export async function fetchPostRowsForExport(
  workspaceId: string,
  sinceIso: string,
  channel?: SocialChannel,
  productId?: string,
): Promise<AnalyticsPostRow[]> {
  const baseQuery = adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published');
  const query = selectAnalyticsPostFields(
    (productId ? baseQuery.where('productId', '==', productId) : baseQuery)
      .where('publishedAt', '>=', sinceIso)
      .orderBy('publishedAt', 'desc')
      .limit(5000),
  );
  const snap = await query.get();

  const rows: AnalyticsPostRow[] = [];
  for (const doc of snap.docs) {
    const post = doc.data() as PostDocData;
    // Sandbox posts never reached a platform; they must not appear in any
    // leaderboard or total an integrator's test run touches.
    if (post.testMode === true) continue;
    if (productId && post.productId !== productId) continue;
    const row = postToRow(doc.id, post, channel);
    if (channel && !row.channels.includes(channel)) continue;
    rows.push(row);
  }
  return rows;
}
