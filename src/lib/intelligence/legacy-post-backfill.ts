import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { getConnectionForChannel } from '@/lib/platform/connections';
import type { NormalizedPostMetrics, PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { getPostChannelDestinations } from '@/lib/social/publisher';
import { upsertMarkaestroSocialPost } from './canonical-social-posts';
import { metricsForLegacyBackfill, publishedChannelTargets } from './publish-targets';

/** Bounded so a workspace tick stays inside the Cloud Tasks deadline. */
export const MAX_LEGACY_SOCIAL_POST_BACKFILL_PER_TICK = 200;

type LegacyPostDoc = {
  channel?: string;
  targetChannels?: string[];
  externalId?: string;
  productId?: string;
  campaignId?: string;
  content?: string;
  mediaUrls?: string[];
  destinationId?: string;
  destinationProvider?: string;
  channelDestinations?: Record<string, string>;
  publishedAt?: string;
  publishResults?: Array<{ channel?: string; success?: boolean; externalId?: string }>;
  metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
  metricsUpdatedAt?: string;
};

export type LegacySocialPostBackfillResult = {
  scanned: number;
  written: number;
  skippedNoTarget: number;
  skippedNoConnection: number;
  lastId: string | null;
  done: boolean;
};

function fallbackConnection(input: {
  workspaceId: string;
  channel: SocialChannel;
  productId?: string;
  destinationId?: string;
  destinationProvider?: string;
  nowIso: string;
}): PlatformConnection | null {
  if (!input.destinationId) return null;
  return {
    provider: input.destinationProvider || input.channel,
    accountKey: input.destinationId,
    channels: [input.channel],
    capabilities: [],
    status: 'error',
    accessTokenEncrypted: '',
    metadata: {},
    workspaceId: input.workspaceId,
    productId: input.productId,
    updatedBy: 'system',
    updatedAt: input.nowIso,
    createdAt: input.nowIso,
  };
}

/**
 * Project already-published `posts` into canonical `socialPosts` using stored
 * `metricsByChannel`. Idempotent: canonical ids match later poller dual-writes.
 */
export async function backfillLegacySocialPosts(
  workspaceId: string,
  nowIso: string,
  opts?: { afterId?: string; limit?: number },
): Promise<LegacySocialPostBackfillResult> {
  const limit = opts?.limit ?? MAX_LEGACY_SOCIAL_POST_BACKFILL_PER_TICK;
  let query = adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('status', '==', 'published')
    .orderBy(FieldPath.documentId());
  if (opts?.afterId) query = query.startAfter(opts.afterId);
  const snapshot = await query.limit(limit + 1).get();
  const page = snapshot.docs.slice(0, limit);
  const result: LegacySocialPostBackfillResult = {
    scanned: page.length,
    written: 0,
    skippedNoTarget: 0,
    skippedNoConnection: 0,
    lastId: page.at(-1)?.id ?? opts?.afterId ?? null,
    done: snapshot.size <= limit,
  };

  const connectionCache = new Map<string, PlatformConnection | null>();

  for (const doc of page) {
    const post = doc.data() as LegacyPostDoc;
    const targets = publishedChannelTargets(post);
    if (targets.length === 0) {
      result.skippedNoTarget += 1;
      continue;
    }
    const publishedAt = post.publishedAt || nowIso;
    const channelDestinations = getPostChannelDestinations(post as unknown as Record<string, unknown>);
    const capturedAt = post.metricsUpdatedAt || publishedAt || nowIso;

    for (const target of targets) {
      const destinationId = channelDestinations[target.channel];
      const cacheKey = `${target.channel}:${post.productId || ''}:${destinationId || ''}`;
      let connection = connectionCache.get(cacheKey);
      if (connection === undefined) {
        connection = await getConnectionForChannel(
          workspaceId,
          target.channel,
          post.productId || undefined,
          post.destinationProvider || undefined,
          destinationId,
        );
        if (!connection) {
          connection = fallbackConnection({
            workspaceId,
            channel: target.channel,
            productId: post.productId,
            destinationId,
            destinationProvider: post.destinationProvider,
            nowIso,
          });
        }
        connectionCache.set(cacheKey, connection);
      }
      if (!connection) {
        result.skippedNoConnection += 1;
        continue;
      }
      await upsertMarkaestroSocialPost({
        workspaceId,
        legacyPostId: doc.id,
        productId: post.productId,
        campaignId: post.campaignId,
        channel: target.channel,
        externalId: target.externalId,
        publishedAt,
        content: post.content,
        mediaUrls: post.mediaUrls,
        connection,
        metrics: metricsForLegacyBackfill(post.metricsByChannel, target.channel),
        capturedAt,
        stageKey: 'legacy-backfill',
      });
      result.written += 1;
    }
  }

  logger.info('legacy social post backfill page', {
    event: 'intelligence.legacy_social_post_backfill',
    workspaceId,
    ...result,
  });
  return result;
}
