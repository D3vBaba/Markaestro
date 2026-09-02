/**
 * Response shape of GET /api/analytics — shared between the server-side query
 * builder and the client page. Keep this file free of server-only imports.
 */
import type { SocialChannel } from '@/lib/schemas';

export type PostContentType = 'image' | 'video' | 'carousel' | 'text';

export type AnalyticsPostRow = {
  id: string;
  content: string;
  channels: SocialChannel[];
  publishedAt: string;
  externalUrl: string | null;
  productId: string | null;
  contentType: PostContentType;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  engagements: number | null;
  /** Engagement rate by reach (engagements ÷ reach), null when reach is unavailable. */
  erByReach: number | null;
  /** Engagement rate by views (engagements ÷ views); the fallback where a platform never reports reach. */
  erByViews: number | null;
};

export type AnalyticsTotals = {
  posts: number;
  views: number | null;
  reach: number | null;
  engagements: number | null;
  engagementRateByReach: number | null;
  engagementRateByViews: number | null;
};

export type EngagementBreakdown = {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
};

export type DailyPoint = { date: string; views: number; reach: number; engagements: number; posts: number };

export type AnalyticsResponse = {
  window: {
    days: number;
    since: string;
    until: string;
    requestedDays: number;
    maxDays: number;
    tier: string;
    /** True when the caller asked for an explicit since/until rather than a preset. */
    custom: boolean;
    priorSince: string;
    priorUntil: string;
  };
  totals: AnalyticsTotals & {
    followers: number | null;
    followerDelta: number | null;
    prior: (AnalyticsTotals & { followerDelta: number | null }) | null;
  };
  /** Latest metrics of the posts published each day (what the day's posts earned). */
  daily: DailyPoint[];
  /** The same series for the period before the window, aligned by index, for comparison overlays. */
  priorDaily: DailyPoint[];
  /** Growth observed each day across all posts (what happened that day), booked at poll time. */
  dailyActivity: DailyPoint[];
  /** What people did, totalled over the window, with the prior window for deltas. */
  breakdown: EngagementBreakdown & { prior: EngagementBreakdown | null };
  followerTrend: Array<{ date: string; total: number }>;
  channels: Array<{
    channel: SocialChannel;
    posts: number;
    views: number | null;
    reach: number | null;
    engagements: number | null;
    engagementRateByReach: number | null;
    engagementRateByViews: number | null;
    followers: number | null;
    followerDelta: number | null;
  }>;
  leaderboard: AnalyticsPostRow[];
  heatmap: {
    /** [day 0=Mon..6=Sun][hour 0..23] — totals per cell. */
    engagements: number[][];
    posts: number[][];
    sampleSize: number;
    tzOffsetMinutes: number;
  };
  contentTypes: Array<{
    type: PostContentType;
    posts: number;
    avgViews: number | null;
    avgEngagements: number | null;
  }>;
  insights: Array<{ id: string; text: string; sampleSize: number }>;
  coverage: {
    postsAnalyzed: number;
    postsWithMetrics: number;
    truncated: boolean;
    lastMetricsAt: string | null;
  };
};
