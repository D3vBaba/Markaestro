import { emptyMetrics } from '@/lib/platform/base-adapter';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export type PublishedChannelTarget = { channel: SocialChannel; externalId: string };

const knownChannels = new Set<string>(socialChannels);

/**
 * Channel + platform post ID pairs that a published Markaestro post actually
 * landed on. Prefer per-channel publishResults; fall back to the single-channel
 * `channel` / `externalId` pair used by older posts.
 */
export function publishedChannelTargets(post: {
  channel?: string;
  externalId?: string;
  publishResults?: Array<{ channel?: string; success?: boolean; externalId?: string }>;
}): PublishedChannelTarget[] {
  const targets = new Map<string, PublishedChannelTarget>();
  for (const entry of post.publishResults ?? []) {
    if (!entry.success || !entry.channel || !entry.externalId || !knownChannels.has(entry.channel)) {
      continue;
    }
    targets.set(entry.channel, {
      channel: entry.channel as SocialChannel,
      externalId: entry.externalId,
    });
  }
  if (targets.size === 0 && post.channel && post.externalId && knownChannels.has(post.channel)) {
    targets.set(post.channel, {
      channel: post.channel as SocialChannel,
      externalId: post.externalId,
    });
  }
  return [...targets.values()];
}

/** Use stored metrics as-is. Missing channel metrics stay all-null, never zero. */
export function metricsForLegacyBackfill(
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>> | undefined,
  channel: SocialChannel,
): NormalizedPostMetrics {
  return byChannel?.[channel] ?? emptyMetrics();
}
