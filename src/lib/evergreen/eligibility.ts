import type { SocialChannel } from '@/lib/schemas';
import type { EvergreenEvidence } from './types';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';

export const evergreenMetricKeys = ['views', 'impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks'] as const;
type Metric = typeof evergreenMetricKeys[number];
export type EvergreenObservation = {
  channel: SocialChannel;
  capturedAt: string | null;
  metrics: Record<Metric, number | null>;
};
export type EvergreenEligibility = {
  /** Operational eligibility for manual reuse, never a performance endorsement. */
  eligible: boolean;
  reasons: string[];
  channels: SocialChannel[];
  evidence: EvergreenEvidence | null;
  suitability: 'needs_review';
  performance: 'unavailable';
  recommendation: 'insufficient_evidence';
  observations: EvergreenObservation[];
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function evaluateEvergreenEligibility(post: Record<string, unknown>, now = new Date()): EvergreenEligibility {
  const values = Array.isArray(post.targetChannels) && post.targetChannels.length ? post.targetChannels : [post.channel];
  const channels = [...new Set(values.filter((v): v is SocialChannel => typeof v === 'string' && Boolean(getSocialChannelConfig(v))))];
  const reasons: string[] = [];
  if (post.status !== 'published') reasons.push('SOURCE_NOT_PUBLISHED');
  const publishedMs = typeof post.publishedAt === 'string' ? Date.parse(post.publishedAt) : NaN;
  if (!Number.isFinite(publishedMs)) reasons.push('SOURCE_PUBLISH_DATE_MISSING');
  else if (publishedMs > now.getTime()) reasons.push('SOURCE_PUBLISH_DATE_FUTURE');
  if (!channels.length) reasons.push('SOURCE_HAS_NO_CHANNEL');
  const byChannel = record(post.metricsByChannel);
  const observations = channels.map((channel): EvergreenObservation => {
    // Legacy totals cannot be attributed to individual channels of a multi-channel post.
    const row = record(byChannel[channel] ?? (channels.length === 1 ? post.metrics ?? post : null));
    const availability = record(row.availability);
    const captured = record(row.source).measuredAt ?? post.metricsUpdatedAt;
    const capturedMs = typeof captured === 'string' ? Date.parse(captured) : NaN;
    return {
      channel,
      capturedAt: Number.isFinite(capturedMs) && capturedMs >= publishedMs && capturedMs <= now.getTime() ? new Date(capturedMs).toISOString() : null,
      metrics: Object.fromEntries(evergreenMetricKeys.map((key) => {
        const value = row[key];
        const state = record(availability[key]).state;
        return [key, (!state || state === 'available') && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
      })) as Record<Metric, number | null>,
    };
  });
  return {
    eligible: reasons.length === 0, reasons, channels, observations,
    // No available study supplies a calibrated repeat-performance evidence rule.
    // Reference averages lack matched post-age windows and cohorts. Do not
    // fabricate activation evidence or a capture timestamp from these counts.
    evidence: null, suitability: 'needs_review', performance: 'unavailable', recommendation: 'insufficient_evidence',
  };
}
