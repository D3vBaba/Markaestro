/**
 * Request and response shapes of the public analytics surface.
 *
 * Kept free of server imports on purpose: `openapi.ts` loads this file to
 * describe the API, and the OpenAPI generator runs without Firestore. The
 * loaders that produce these shapes live in `./analytics.ts`.
 */

import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';
import { analyticsPostSources } from '@/lib/analytics/api-shape';

export const ANALYTICS_MAX_WINDOW_DAYS = 365;

const utcDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a UTC date as YYYY-MM-DD');

/**
 * The reporting window. A preset (`days`, ending today UTC) or an explicit
 * `since`/`until` range; both are clamped to the plan's history window and
 * the response says what it was clamped to.
 */
export const analyticsWindowQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(ANALYTICS_MAX_WINDOW_DAYS).default(28)
    .describe('Preset window in days, ending today (UTC). Clamped to the plan history window; the response reports maxDays.'),
  since: utcDate.optional()
    .describe('Explicit range start as a UTC date. Used only when until is also given and is not before since.'),
  until: utcDate.optional()
    .describe('Explicit range end as a UTC date, inclusive. Ends today when it names a future date.'),
  channel: z.enum(socialChannels).optional()
    .describe('Restrict every number to one channel.'),
  source: z.enum(analyticsPostSources).optional()
    .describe('Restrict to posts published through Markaestro (markaestro) or directly on the platform and discovered from the connected account (native). Without it the whole account counts.'),
  tz: z.coerce.number().int().min(-840).max(840).default(0)
    .describe('Viewer timezone offset in minutes east of UTC. Shapes the posting-time heatmap only.'),
});

export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>;

export const analyticsPostSortKeys = ['published_at', 'views', 'reach', 'engagements', 'engagement_rate'] as const;
export type AnalyticsPostSortKey = (typeof analyticsPostSortKeys)[number];

export const analyticsPostsQuerySchema = analyticsWindowQuerySchema.omit({ tz: true }).extend({
  limit: z.coerce.number().int().min(1).max(500).default(100)
    .describe('Rows to return after sorting. The response says whether more matched.'),
  sort: z.enum(analyticsPostSortKeys).default('published_at')
    .describe('Descending. engagement_rate uses reach, and views where a channel never reports reach. Posts without the metric sort last.'),
});

export type AnalyticsPostsQuery = z.infer<typeof analyticsPostsQuerySchema>;

const count = z.number().int();
const metric = z.number().nullable().describe('null when no channel in scope reports it');
const rate = z.number().nullable().describe('A ratio (0.05 is 5%); null when the denominator is unavailable');

export const publicAnalyticsPostRowSchema = z.object({
  id: z.string(),
  content: z.string().describe('The first 160 characters of the caption.'),
  channels: z.array(z.enum(socialChannels).or(z.string())),
  publishedAt: z.string().describe('ISO 8601 timestamp'),
  externalUrl: z.string().nullable().describe('The live post, when the platform reported one.'),
  productId: z.string().nullable(),
  contentType: z.enum(['image', 'video', 'carousel', 'text']),
  source: z.enum(analyticsPostSources)
    .describe('markaestro when the post went out through Markaestro (or was marked as posted by hand); native when it was published directly on the platform and discovered from the connected account.'),
  views: metric,
  reach: metric,
  likes: metric,
  comments: metric,
  shares: metric,
  saves: metric,
  clicks: metric,
  engagements: metric.describe('likes + comments + shares + saves + clicks, per channel, summed'),
  erByReach: rate.describe('engagements / reach'),
  erByViews: rate.describe('engagements / views; the fallback where a platform never reports reach (TikTok, Threads)'),
}).describe('One published post with its latest stored metrics, summed across the channels in scope.');

const dailyPointSchema = z.object({
  date: z.string().describe('UTC date, YYYY-MM-DD'),
  views: z.number(),
  reach: z.number(),
  engagements: z.number(),
  posts: count,
});

const totalsSchema = z.object({
  posts: count,
  views: metric,
  reach: metric,
  engagements: metric,
  engagementRateByReach: rate,
  engagementRateByViews: rate,
});

const breakdownSchema = z.object({
  likes: metric,
  comments: metric,
  shares: metric,
  saves: metric,
  clicks: metric,
});

export const publicAnalyticsOverviewSchema = z.object({
  window: z.object({
    days: count.describe('The window actually reported, after the plan clamp.'),
    since: z.string(),
    until: z.string(),
    requestedDays: count,
    maxDays: count.describe('The plan history window in days; -1 means unlimited.'),
    tier: z.string(),
    custom: z.boolean().describe('True when since/until were used rather than the days preset.'),
    priorSince: z.string(),
    priorUntil: z.string(),
  }),
  totals: totalsSchema.extend({
    followers: metric.describe('Latest follower count across the channels in scope.'),
    followerDelta: metric.describe('Follower change over the window.'),
    prior: totalsSchema.extend({ followerDelta: metric }).nullable()
      .describe('The same totals for the period immediately before the window, for deltas.'),
  }),
  daily: z.array(dailyPointSchema).describe('What the posts published each day earned (their latest metrics).'),
  priorDaily: z.array(dailyPointSchema).describe('The prior period, aligned by index for overlays.'),
  dailyActivity: z.array(dailyPointSchema).describe('Growth observed each day across all posts, booked at poll time.'),
  breakdown: breakdownSchema.extend({ prior: breakdownSchema.nullable() }),
  followerTrend: z.array(z.object({ date: z.string(), total: z.number() })),
  channels: z.array(z.object({
    channel: z.enum(socialChannels).or(z.string()),
    posts: count,
    views: metric,
    reach: metric,
    engagements: metric,
    engagementRateByReach: rate,
    engagementRateByViews: rate,
    followers: metric,
    followerDelta: metric,
  })),
  leaderboard: z.array(publicAnalyticsPostRowSchema).describe('Top posts by engagement, at most 50.'),
  heatmap: z.object({
    engagements: z.array(z.array(z.number())).describe('[weekday 0=Mon..6=Sun][hour 0..23] engagement totals in the tz offset'),
    posts: z.array(z.array(z.number())).describe('[weekday][hour] post counts'),
    sampleSize: count,
    tzOffsetMinutes: count,
  }),
  contentTypes: z.array(z.object({
    type: z.enum(['image', 'video', 'carousel', 'text']),
    posts: count,
    avgViews: metric,
    avgEngagements: metric,
  })),
  insights: z.array(z.object({
    id: z.string(),
    text: z.string(),
    sampleSize: count,
  })).describe('Plain-language observations computed from the rows, each with the sample it rests on.'),
  coverage: z.object({
    postsAnalyzed: count,
    postsWithMetrics: count,
    truncated: z.boolean().describe('True when the window held more posts than the analysis cap (500).'),
    lastMetricsAt: z.string().nullable(),
    bySource: z.object({
      markaestro: count,
      native: count,
    }).describe('How many of the analyzed posts came from each source.'),
  }),
});

export const publicAnalyticsOverviewEnvelopeSchema = z.object({ analytics: publicAnalyticsOverviewSchema });

export const publicAnalyticsPostListSchema = z.object({
  window: z.object({
    days: count,
    since: z.string(),
    until: z.string(),
    maxDays: count,
    tier: z.string(),
  }),
  sort: z.enum(analyticsPostSortKeys),
  posts: z.array(publicAnalyticsPostRowSchema),
  count,
  truncated: z.boolean().describe('True when more posts matched than limit allowed.'),
});

const channelMetricsSchema = z.object({
  impressions: metric,
  views: metric,
  reach: metric,
  likes: metric,
  comments: metric,
  shares: metric,
  saves: metric,
  clicks: metric,
  profileVisits: metric,
  followersGained: metric,
  watchTimeSeconds: metric,
  averageWatchTimeSeconds: metric,
  completionRate: metric,
  conversions: metric,
  videoViews: metric,
}).partial().describe('The metrics one platform reported for the post at that stage.');

export const publicAnalyticsPostHistoryStageSchema = z.object({
  stageKey: z.string().describe('1h, 6h, 24h, 72h, 7d, 14d, 30d, 60d, 90d, or latest'),
  capturedAt: z.string(),
  hoursAfterPublish: z.number().nullable(),
  views: metric,
  reach: metric,
  engagements: metric,
  likes: metric,
  comments: metric,
  shares: metric,
  saves: metric,
  viewsDelta: metric.describe('Growth since the previous stage; null on the first stage.'),
  engagementsDelta: metric,
  byChannel: z.record(z.string(), channelMetricsSchema),
});

export const publicAnalyticsPostHistorySchema = z.object({
  post: z.object({
    id: z.string(),
    content: z.string(),
    publishedAt: z.string().nullable(),
    channels: z.array(z.string()),
    externalUrl: z.string().nullable(),
    source: z.enum(analyticsPostSources)
      .describe('markaestro for a post that went out through Markaestro; native for one published directly on the platform.'),
    metricsStatus: z.enum(['active', 'complete', 'unsupported', 'failed']).or(z.string()).nullable()
      .describe('active: still being polled. complete: the 90-day schedule finished and the numbers are frozen. unsupported: the platform reports no metrics for this post.'),
    nextPollAt: z.string().nullable(),
    latest: publicAnalyticsPostRowSchema.describe('The current totals, the same row the list endpoint returns.'),
  }),
  stages: z.array(publicAnalyticsPostHistoryStageSchema)
    .describe('Oldest first: how the post earned its numbers over time rather than only where it ended up.'),
});
