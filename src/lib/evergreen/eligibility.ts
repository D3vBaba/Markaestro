import type { SocialChannel } from '@/lib/schemas';
import type { EvergreenEvidence } from './types';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';

export type EvergreenEligibility = {
  eligible: boolean;
  reasons: string[];
  channels: SocialChannel[];
  evidence: EvergreenEvidence | null;
};

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function channelsFromPost(post: Record<string, unknown>): SocialChannel[] {
  const values = Array.isArray(post.targetChannels) && post.targetChannels.length > 0
    ? post.targetChannels
    : [post.channel];
  return values.filter((value): value is SocialChannel => typeof value === 'string' && Boolean(getSocialChannelConfig(value)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

function measuredSignal(post: Record<string, unknown>) {
  const perChannel = post.metricsByChannel && typeof post.metricsByChannel === 'object'
    ? Object.values(post.metricsByChannel as Record<string, unknown>)
    : [];
  const rows = perChannel.length > 0
    ? perChannel.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [post.metrics && typeof post.metrics === 'object' ? post.metrics as Record<string, unknown> : post];
  const engagements = rows.reduce(
    (total, metrics) => total + ['likes', 'comments', 'shares', 'saves', 'clicks']
      .reduce((subtotal, key) => subtotal + number(metrics[key]), 0),
    0,
  );
  const views = rows.reduce(
    (total, metrics) => total + (number(metrics.views) || number(metrics.impressions)),
    0,
  );
  return { engagements, views };
}

export function evaluateEvergreenEligibility(
  post: Record<string, unknown>,
  now = new Date(),
): EvergreenEligibility {
  const reasons: string[] = [];
  if (post.status !== 'published') reasons.push('SOURCE_NOT_PUBLISHED');
  const publishedAt = typeof post.publishedAt === 'string' ? post.publishedAt : '';
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) reasons.push('SOURCE_PUBLISH_DATE_MISSING');
  else if (now.getTime() - publishedMs < 7 * 24 * 60 * 60 * 1000) reasons.push('SOURCE_METRICS_IMMATURE');

  const { engagements, views } = measuredSignal(post);
  if (engagements <= 0 && views <= 0) reasons.push('SOURCE_HAS_NO_MEASURED_SIGNAL');
  const channels = channelsFromPost(post);
  if (channels.length === 0) reasons.push('SOURCE_HAS_NO_CHANNEL');

  const metric = engagements > 0 ? 'engagements' as const : 'views' as const;
  const value = engagements > 0 ? engagements : views;
  return {
    eligible: reasons.length === 0,
    reasons,
    channels,
    evidence: reasons.includes('SOURCE_PUBLISH_DATE_MISSING') || value <= 0
      ? null
      : {
          capturedAt: now.toISOString(),
          sourcePublishedAt: publishedAt,
          metric,
          value,
          sampleSize: Math.max(1, views),
          explanation: `This post has ${value} measured ${metric} after at least seven days.`,
        },
  };
}
