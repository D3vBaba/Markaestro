import { engagementTotal, measuredNumber, sumMeasured } from './overview-metrics';
import { hourBucket } from './historical-fit';

export type StrategistPost = {
  id: unknown;
  platform?: unknown;
  publishedAt?: unknown;
  content?: unknown;
  latestMetrics?: Record<string, number | null> | null;
  fingerprintSummary?: unknown;
  fingerprint?: { pillar?: string | null; hook?: string | null } | null;
};

export function strategistPostRows(posts: StrategistPost[]) {
  return posts.map((post) => {
    const metrics = post.latestMetrics || {};
    return {
      id: String(post.id || ''),
      platform: String(post.platform || 'unknown'),
      publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt : null,
      content: typeof post.content === 'string' ? post.content.slice(0, 500) : null,
      views: measuredNumber(metrics.views),
      reach: measuredNumber(metrics.reach),
      clicks: measuredNumber(metrics.clicks),
      engagements: engagementTotal(metrics),
      pillar: post.fingerprint?.pillar || null,
      hook: post.fingerprint?.hook || null,
      fingerprint: post.fingerprintSummary || post.fingerprint || null,
    };
  });
}

export type StrategistPostRow = ReturnType<typeof strategistPostRows>[number];

export function topPostsByViews(rows: StrategistPostRow[], limit = 20) {
  return [...rows]
    .sort((a, b) => (b.views ?? Number.NEGATIVE_INFINITY) - (a.views ?? Number.NEGATIVE_INFINITY))
    .slice(0, limit);
}

export function platformComparisons(rows: StrategistPostRow[]) {
  const grouped = new Map<string, { id: string; posts: number; views: Array<number | null>; engagements: Array<number | null> }>();
  for (const row of rows) {
    const value = grouped.get(row.platform) || { id: row.platform, posts: 0, views: [], engagements: [] };
    value.posts += 1;
    value.views.push(row.views);
    value.engagements.push(row.engagements);
    grouped.set(row.platform, value);
  }
  return [...grouped.values()].map((group) => ({
    id: group.id,
    posts: group.posts,
    views: sumMeasured(group.views),
    engagements: sumMeasured(group.engagements),
  }));
}

export function groupedPerformance(
  rows: StrategistPostRow[],
  keyOf: (row: StrategistPostRow) => string | null,
) {
  const grouped = new Map<string, StrategistPostRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([id, items]) => ({
    id,
    posts: items.length,
    views: sumMeasured(items.map((item) => item.views)),
    engagements: sumMeasured(items.map((item) => item.engagements)),
  }));
}

export function timingPerformance(rows: StrategistPostRow[], timeZone: string) {
  return groupedPerformance(rows, (row) => (row.publishedAt ? hourBucket(row.publishedAt, timeZone) : null));
}
