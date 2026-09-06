import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { logger } from '@/lib/logger';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import {
  isNativePostDoc,
  markaestroPlatformPostKeys,
  nativePostsQuery,
  platformPostKey,
  type NativeSocialPostDoc,
} from './native-posts';
import { engagementTotal, type ChannelDayAggregate, type DailyAggregateDoc } from './types';

function emptyChannelAggregate(): ChannelDayAggregate {
  return {
    posts: 0,
    views: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: 0,
    engagements: 0,
    postsWithViews: 0,
    postsWithReach: 0,
    postsWithEngagements: 0,
  };
}

type PostDocData = {
  channel?: string;
  testMode?: boolean;
  productId?: string;
  externalId?: string;
  publishResults?: Array<{ channel?: string; success?: boolean; externalId?: string }>;
  publishedChannels?: string[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
};

/** One post as the rollup sees it, whichever collection it came from. */
type RollupEntry = {
  productId: string | null;
  channels: string[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
};

/**
 * The native posts published on the day. A read failure (an index still
 * deploying, a transient outage) is logged and yields none, so the rollup
 * of the Markaestro posts still lands; the native poller's next observation
 * of the day recomputes it.
 */
async function nativeRollupEntries(
  workspaceId: string,
  start: string,
  end: string,
  claimed: Set<string>,
): Promise<RollupEntry[]> {
  try {
    const docs = await getAllMatchingDocs(nativePostsQuery(workspaceId, { sinceIso: start, untilIsoExclusive: end }));
    const entries: RollupEntry[] = [];
    for (const doc of docs) {
      const native = doc.data() as NativeSocialPostDoc;
      if (!isNativePostDoc(native)) continue;
      // The same post seen from the account side; the `posts` row counts it.
      if (claimed.has(platformPostKey(native.platform, native.externalId))) continue;
      entries.push({
        productId: typeof native.productId === 'string' && native.productId ? native.productId : null,
        channels: [native.platform],
        metricsByChannel: native.metricsByChannel,
      });
    }
    return entries;
  } catch (error) {
    logger.warn('native posts unavailable to the daily rollup', {
      event: 'analytics.native_rollup_unavailable',
      workspaceId,
      date: start.slice(0, 10),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function accumulateChannelMetrics(
  agg: ChannelDayAggregate,
  metrics: NormalizedPostMetrics | undefined,
): void {
  agg.posts++;
  if (!metrics) return;
  if (metrics.views !== null) { agg.views += metrics.views; agg.postsWithViews++; }
  if (metrics.reach !== null) { agg.reach += metrics.reach; agg.postsWithReach++; }
  if (metrics.likes !== null) agg.likes += metrics.likes;
  if (metrics.comments !== null) agg.comments += metrics.comments;
  if (metrics.shares !== null) agg.shares += metrics.shares;
  if (metrics.saves !== null) agg.saves += metrics.saves;
  if (metrics.clicks !== null) agg.clicks += metrics.clicks;
  const engagements = engagementTotal(metrics);
  if (engagements !== null) { agg.engagements += engagements; agg.postsWithEngagements++; }
}

/**
 * Recompute the per-day rollup docs (workspaces/{ws}/analyticsDaily/{date})
 * for the given UTC dates from the posts published on those dates. Called by
 * the worker after each poll batch, so the analytics API reads at most ~90
 * small documents instead of scanning posts and snapshots.
 */
export async function recomputeDailyAggregates(workspaceId: string, dates: string[]): Promise<number> {
  const nowIso = new Date().toISOString();
  let written = 0;

  for (const date of [...new Set(dates)]) {
    const start = `${date}T00:00:00.000Z`;
    const end = new Date(Date.parse(start) + 24 * 3600_000).toISOString();

    const docs = await getAllMatchingDocs(
      adminDb
        .collection(`workspaces/${workspaceId}/posts`)
        .where('status', '==', 'published')
        .where('publishedAt', '>=', start)
        .where('publishedAt', '<', end),
    );

    // Sandbox posts (mk_test_ keys) never reached a platform; counting them
    // would inflate every rollup an integrator's test run touches.
    const posts = docs.map((doc) => doc.data() as PostDocData).filter((post) => post.testMode !== true);
    const entries: RollupEntry[] = posts.map((post) => ({
      productId: typeof post.productId === 'string' && post.productId ? post.productId : null,
      channels: (post.publishedChannels?.length ? post.publishedChannels : [post.channel])
        .filter((c): c is string => Boolean(c)),
      metricsByChannel: post.metricsByChannel,
    }));
    // Posts published directly on the platform join the same rollup, so the
    // totals describe the account rather than the Markaestro half of it.
    entries.push(...await nativeRollupEntries(workspaceId, start, end, markaestroPlatformPostKeys(posts)));

    const channels: Partial<Record<SocialChannel, ChannelDayAggregate>> = {};
    const byProduct: NonNullable<DailyAggregateDoc['byProduct']> = {};
    let totalPosts = 0;

    for (const entry of entries) {
      totalPosts++;

      // Per-brand bucket alongside the workspace-wide one (5.10). The worker
      // already reads every post for the day, so the extra dimension costs
      // arithmetic, not reads.
      const productId = entry.productId;
      const productBucket = productId
        ? (byProduct[productId] ?? (byProduct[productId] = { posts: 0, channels: {} }))
        : null;
      if (productBucket) productBucket.posts++;

      for (const channelName of new Set(entry.channels)) {
        const channel = channelName as SocialChannel;
        const metrics = entry.metricsByChannel?.[channel];
        accumulateChannelMetrics(
          channels[channel] ?? (channels[channel] = emptyChannelAggregate()),
          metrics,
        );
        if (productBucket) {
          accumulateChannelMetrics(
            productBucket.channels[channel] ?? (productBucket.channels[channel] = emptyChannelAggregate()),
            metrics,
          );
        }
      }
    }

    const doc: DailyAggregateDoc = { date, channels, byProduct, posts: totalPosts, updatedAt: nowIso };
    await adminDb.doc(`workspaces/${workspaceId}/analyticsDaily/${date}`).set(doc);
    written++;
  }

  return written;
}
