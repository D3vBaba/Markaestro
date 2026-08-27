import type { NormalizedPostMetrics } from '@/lib/platform/types';

export const overviewMetricKeys = [
  'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'conversions',
] as const;

export type OverviewMetricKey = (typeof overviewMetricKeys)[number];

type MetricSource = Partial<Pick<NormalizedPostMetrics, OverviewMetricKey | 'likes' | 'comments' | 'shares' | 'saves'>>;

export function measuredNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Sum only returned values. All-null stays null — never a fabricated zero. */
export function sumMeasured(values: unknown[]): number | null {
  const numbers = values.map(measuredNumber).filter((value): value is number => value !== null);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

export function engagementTotal(metrics: MetricSource): number | null {
  return sumMeasured([metrics.likes, metrics.comments, metrics.shares, metrics.saves]);
}

/** Engagements per view, only when both sides were reported and views are positive. */
export function engagementRate(engagements: number | null, views: number | null): number | null {
  if (engagements === null || views === null || views <= 0) return null;
  return engagements / views;
}

/** Compact, display-safe projection of a stored content fingerprint. */
export type PostFingerprintSummary = {
  kind: string | null;
  pillar: string | null;
  hook: string | null;
  topics: string[];
  cta: string | null;
  sentiment: string | null;
  structure: string[];
  openingStyle: string | null;
};

export function fingerprintSummaryFromPost(value: unknown): PostFingerprintSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === 'string' && (raw[key] as string).trim() ? (raw[key] as string).trim() : null);
  const list = (key: string, max: number) => (Array.isArray(raw[key])
    ? (raw[key] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max)
    : []);
  const summary: PostFingerprintSummary = {
    kind: text('kind'),
    pillar: text('pillar'),
    hook: text('hook'),
    topics: list('topics', 6),
    cta: text('cta'),
    sentiment: text('sentiment'),
    structure: list('structure', 4),
    openingStyle: text('openingStyle'),
  };
  const empty = !summary.kind && !summary.pillar && !summary.hook && summary.topics.length === 0;
  return empty ? null : summary;
}

export type OverviewPostRow = {
  id: string;
  platform: string;
  content: string | null;
  publishedAt: string | null;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  username: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  externalUrl: string | null;
  fingerprint: PostFingerprintSummary | null;
};

export type OverviewChannelRow = {
  platform: string;
  posts: number;
  views: number | null;
  engagements: number | null;
  /** Posts on this platform that reported views / engagements. */
  measuredViews?: number;
  measuredEngagements?: number;
  avgViews?: number | null;
  avgEngagements?: number | null;
  /** Engagements per view across posts that reported both. */
  engagementRate?: number | null;
};

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Prefer stored handle; fall back to @user in common permalink shapes. */
export function usernameFromSocialPost(post: {
  accountUsername?: unknown;
  username?: unknown;
  permalink?: unknown;
  externalUrl?: unknown;
}): string | null {
  for (const candidate of [post.accountUsername, post.username]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().replace(/^@/, '');
    }
  }
  const url = typeof post.permalink === 'string' && post.permalink.trim()
    ? post.permalink.trim()
    : typeof post.externalUrl === 'string' && post.externalUrl.trim()
      ? post.externalUrl.trim()
      : null;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const atMatch = parsed.pathname.match(/\/@([^/?#]+)/);
    if (atMatch?.[1]) return decodeURIComponent(atMatch[1]);
    if (parsed.hostname.includes('instagram.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts[0] && !['p', 'reel', 'tv', 'stories', 'share'].includes(parts[0].toLowerCase())) {
        return decodeURIComponent(parts[0]);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export type RollupSocialPost = {
  id: string;
  platform?: string;
  content?: unknown;
  publishedAt?: unknown;
  mediaUrls?: unknown;
  thumbnailUrl?: unknown;
  externalUrl?: unknown;
  permalink?: unknown;
  accountUsername?: unknown;
  username?: unknown;
  fingerprint?: unknown;
  latestMetrics?: MetricSource;
};

export function rollupSocialPosts(posts: RollupSocialPost[], options: { contentLimit?: number } = {}): {
  totals: Record<OverviewMetricKey, number | null>;
  measured: Record<OverviewMetricKey, number>;
  coverage: Record<OverviewMetricKey, number>;
  channels: OverviewChannelRow[];
  topContent: OverviewPostRow[];
  measuredPosts: OverviewPostRow[];
} {
  const contentLimit = options.contentLimit ?? 4000;
  const totals = Object.fromEntries(overviewMetricKeys.map((key) => [key, 0])) as Record<OverviewMetricKey, number>;
  const measured = Object.fromEntries(overviewMetricKeys.map((key) => [key, 0])) as Record<OverviewMetricKey, number>;
  const byChannel = new Map<string, {
    platform: string;
    posts: number;
    views: number[];
    engagements: number[];
    pairedViews: number;
    pairedEngagements: number;
  }>();

  const rows: OverviewPostRow[] = posts.map((post) => {
    const metrics = post.latestMetrics || {};
    for (const key of overviewMetricKeys) {
      const value = measuredNumber(metrics[key]);
      if (value !== null) {
        totals[key] += value;
        measured[key] += 1;
      }
    }
    const platform = String(post.platform || 'unknown');
    const channel = byChannel.get(platform) || {
      platform, posts: 0, views: [], engagements: [], pairedViews: 0, pairedEngagements: 0,
    };
    channel.posts += 1;
    const views = measuredNumber(metrics.views);
    const engagements = engagementTotal(metrics);
    if (views !== null) channel.views.push(views);
    if (engagements !== null) channel.engagements.push(engagements);
    if (views !== null && engagements !== null) {
      channel.pairedViews += views;
      channel.pairedEngagements += engagements;
    }
    byChannel.set(platform, channel);
    const mediaUrls = asStringList(post.mediaUrls);
    const thumbnail = typeof post.thumbnailUrl === 'string' && post.thumbnailUrl.trim()
      ? post.thumbnailUrl.trim()
      : null;
    const external = typeof post.externalUrl === 'string' && post.externalUrl.trim()
      ? post.externalUrl.trim()
      : typeof post.permalink === 'string' && post.permalink.trim()
        ? post.permalink.trim()
        : null;
    return {
      id: post.id,
      platform,
      content: typeof post.content === 'string' ? post.content.slice(0, contentLimit) : null,
      publishedAt: typeof post.publishedAt === 'string' ? post.publishedAt : null,
      views,
      engagements,
      engagementRate: engagementRate(engagements, views),
      likes: measuredNumber(metrics.likes),
      comments: measuredNumber(metrics.comments),
      shares: measuredNumber(metrics.shares),
      saves: measuredNumber(metrics.saves),
      clicks: measuredNumber(metrics.clicks),
      username: usernameFromSocialPost({ ...post, externalUrl: external }),
      mediaUrls: thumbnail && mediaUrls.length === 0 ? [thumbnail] : mediaUrls,
      thumbnailUrl: thumbnail,
      externalUrl: external,
      fingerprint: fingerprintSummaryFromPost(post.fingerprint),
    };
  });

  rows.sort((a, b) => (b.views ?? Number.NEGATIVE_INFINITY) - (a.views ?? Number.NEGATIVE_INFINITY));
  const postCount = posts.length;
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    totals: Object.fromEntries(
      overviewMetricKeys.map((key) => [key, measured[key] > 0 ? totals[key] : null]),
    ) as Record<OverviewMetricKey, number | null>,
    measured,
    coverage: Object.fromEntries(
      overviewMetricKeys.map((key) => [key, postCount ? Math.round((measured[key] / postCount) * 100) : 0]),
    ) as Record<OverviewMetricKey, number>,
    channels: [...byChannel.values()]
      .map((channel) => ({
        platform: channel.platform,
        posts: channel.posts,
        views: channel.views.length ? channel.views.reduce((sum, value) => sum + value, 0) : null,
        engagements: channel.engagements.length ? channel.engagements.reduce((sum, value) => sum + value, 0) : null,
        measuredViews: channel.views.length,
        measuredEngagements: channel.engagements.length,
        avgViews: mean(channel.views),
        avgEngagements: mean(channel.engagements),
        engagementRate: channel.pairedViews > 0 ? channel.pairedEngagements / channel.pairedViews : null,
      }))
      .sort((a, b) => (b.views ?? -1) - (a.views ?? -1)),
    topContent: rows.slice(0, 10),
    measuredPosts: rows
      .filter((row) => row.views !== null || row.engagements !== null)
      .slice(0, 40),
  };
}
