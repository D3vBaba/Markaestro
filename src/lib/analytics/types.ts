import type { SocialChannel } from '@/lib/schemas';
import type { NormalizedPostMetrics } from '@/lib/platform/types';

// ── Poll schedule ────────────────────────────────────────────────────
//
// Post metrics are captured on a decaying schedule after publish. Each stage
// writes a snapshot under workspaces/{ws}/posts/{id}/metrics/{stageKey} and
// refreshes the denormalized `metricsByChannel` on the post doc. After the
// final stage the post stops being polled.

export const METRIC_POLL_STAGES = [
  { key: '1h', offsetMs: 1 * 3600_000 },
  { key: '6h', offsetMs: 6 * 3600_000 },
  { key: '24h', offsetMs: 24 * 3600_000 },
  { key: '72h', offsetMs: 72 * 3600_000 },
  { key: '7d', offsetMs: 7 * 24 * 3600_000 },
  { key: '14d', offsetMs: 14 * 24 * 3600_000 },
  { key: '30d', offsetMs: 30 * 24 * 3600_000 },
  // Long tail: evergreen posts keep earning; two slow catch-ups cover a quarter.
  { key: '60d', offsetMs: 60 * 24 * 3600_000 },
  { key: '90d', offsetMs: 90 * 24 * 3600_000 },
] as const;

export type MetricPollStageKey = (typeof METRIC_POLL_STAGES)[number]['key'];

/** How far back the one-time backfill initializes polling for old posts. */
export const METRICS_BACKFILL_DAYS = 90;

/** Posts fetched per workspace per tick — bounds platform API bursts. */
export const MAX_METRIC_POLLS_PER_TICK = 20;

/** Consecutive transient failures before a post is parked as 'failed'. */
export const MAX_TRANSIENT_ATTEMPTS = 10;

export type PostMetricsStatus = 'active' | 'complete' | 'unsupported' | 'failed';

/** Fields the poller maintains on the post document. */
export type PostMetricsState = {
  /** Latest normalized metrics per published channel. */
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsUpdatedAt?: string;
  /** Present only while polling is active — drives the due-posts query. */
  metricsNextPollAt?: string;
  metricsPollStage?: number;
  metricsStatus?: PostMetricsStatus;
  metricsAttempts?: number;
  metricsLastError?: string;
};

// ── Firestore documents ─────────────────────────────────────────────

/** workspaces/{ws}/posts/{postId}/metrics/{stageKey} */
export type MetricSnapshotDoc = {
  postId: string;
  stageKey: string;
  capturedAt: string;
  publishedAt: string | null;
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
};

/** workspaces/{ws}/audienceSnapshots/{date_channel_accountKey} */
export type AudienceSnapshotDoc = {
  date: string; // YYYY-MM-DD (UTC)
  channel: SocialChannel;
  provider: string;
  productId: string | null;
  accountKey: string;
  followers: number;
  capturedAt: string;
};

export type ChannelDayAggregate = {
  posts: number;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  engagements: number;
  /** Coverage counters so rates are only computed over posts that reported the metric. */
  postsWithViews: number;
  postsWithReach: number;
  postsWithEngagements: number;
};

/**
 * workspaces/{ws}/analyticsDaily/{YYYY-MM-DD}
 * Per-day rollup of the latest metrics of posts published that (UTC) day,
 * precomputed by the worker so the analytics API never scans raw snapshots.
 */
export type DailyAggregateDoc = {
  date: string;
  channels: Partial<Record<SocialChannel, ChannelDayAggregate>>;
  posts: number;
  updatedAt: string;
  /**
   * The same rollup, one dimension deeper: per brand, per channel (5.10).
   * The per-brand view is the one an agency uses most, and without this it
   * was the slow path, derived from post rows on every request while the
   * workspace-wide view read precomputed docs. At Firestore's 1 MiB document
   * ceiling this holds hundreds of brands; a workspace approaching that
   * should move to a sibling per-product collection, which the shape below
   * makes a mechanical change.
   *
   * Absent on docs written before the field existed; the query layer falls
   * back to post rows for exactly those days.
   */
  byProduct?: Record<string, {
    posts: number;
    channels: Partial<Record<SocialChannel, ChannelDayAggregate>>;
  }>;
};

/** workspaces/{ws}/analytics/meta — cursor/marker state for the analytics worker. */
export type AnalyticsMetaDoc = {
  metricsBackfillAt?: string;
  lastAudienceDate?: string;
  lastAudienceAttemptAt?: string;
  lastSweepAt?: string;
  lastDeadRetryDate?: string;
  /** Last intelligence insight recompute; gates the hourly recompute. */
  lastLearningRecomputeAt?: string;
  socialPostsBackfillAt?: string;
  socialPostsBackfillAfterId?: string;
  /** Published-post fingerprint backfill cursors and daily cap counters. */
  fingerprintRecentCursor?: string | null;
  fingerprintRecentDoneAt?: string;
  fingerprintOlderCursor?: string | null;
  fingerprintOlderDoneAt?: string;
  fingerprintIncrementalAt?: string;
  fingerprintDailyDate?: string;
  fingerprintDailyCount?: number;
  updatedAt?: string;
};

export const ANALYTICS_META_PATH = (workspaceId: string) => `workspaces/${workspaceId}/analytics/meta`;

// ── Shared computation helpers ──────────────────────────────────────

/**
 * Total engagement actions for a post on one channel. Null when the platform
 * reported none of the engagement metrics (so we never render a fake 0).
 */
export function engagementTotal(m: NormalizedPostMetrics): number | null {
  const parts = [m.likes, m.comments, m.shares, m.saves].filter((v): v is number => v !== null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/** Sum a metric across channels; null when no channel reported it. */
export function sumAcrossChannels(
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>,
  pick: (m: NormalizedPostMetrics) => number | null,
): number | null {
  let total: number | null = null;
  for (const m of Object.values(byChannel)) {
    if (!m) continue;
    const v = pick(m);
    if (v === null) continue;
    total = (total ?? 0) + v;
  }
  return total;
}

/** UTC calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function utcDateOf(iso: string): string {
  return iso.slice(0, 10);
}
