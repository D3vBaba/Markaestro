import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
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
  publishedChannels?: string[];
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
};

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

    const channels: Partial<Record<SocialChannel, ChannelDayAggregate>> = {};
    const byProduct: NonNullable<DailyAggregateDoc['byProduct']> = {};
    let totalPosts = 0;

    for (const doc of docs) {
      const post = doc.data() as PostDocData;
      // Sandbox posts (mk_test_ keys) never reached a platform; counting them
      // would inflate every rollup an integrator's test run touches.
      if (post.testMode === true) continue;
      totalPosts++;
      const postChannels = (post.publishedChannels?.length ? post.publishedChannels : [post.channel])
        .filter((c): c is string => Boolean(c));

      // Per-brand bucket alongside the workspace-wide one (5.10). The worker
      // already reads every post for the day, so the extra dimension costs
      // arithmetic, not reads.
      const productId = typeof post.productId === 'string' && post.productId ? post.productId : null;
      const productBucket = productId
        ? (byProduct[productId] ?? (byProduct[productId] = { posts: 0, channels: {} }))
        : null;
      if (productBucket) productBucket.posts++;

      for (const channelName of new Set(postChannels)) {
        const channel = channelName as SocialChannel;
        const metrics = post.metricsByChannel?.[channel];
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
