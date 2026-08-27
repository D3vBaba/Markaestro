import { intelligenceRecordId } from './record-id';
import type { TimingRecommendation } from './timing';
import type { BrandLearning } from './learnings';
import type { OverviewChannelRow } from './overview-metrics';

export type OptimizationOpportunity = {
  id: string;
  productId: string;
  title: string;
  recommendation: string;
  kind: 'timing' | 'platform' | 'learning' | 'alignment';
  evidenceIds: string[];
  status: 'proposed' | 'accepted' | 'dismissed' | 'pinned';
};

export function generateOpportunities(input: {
  productId: string;
  timing: TimingRecommendation;
  channels: OverviewChannelRow[];
  learnings: BrandLearning[];
  alignmentScore: number | null;
  alignmentCoverage: number;
  weakestAlignmentDimension?: { dimension: string; score: number } | null;
  limit?: number;
}): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];
  const bestWindow = input.timing.windows[0];
  if (input.timing.accountSpecific && bestWindow?.estimate != null) {
    opportunities.push({
      id: intelligenceRecordId('opportunity', input.productId, 'timing', bestWindow.bucket),
      productId: input.productId,
      kind: 'timing',
      title: `Post in the ${bestWindow.bucket} window`,
      recommendation: `This weekday/hour has ${bestWindow.observations} measured posts and the strongest account-specific estimate. Keep missing metrics blank when a window still lacks five observations.`,
      evidenceIds: [bestWindow.bucket],
      status: 'proposed',
    });
  }
  const measuredChannels = input.channels.filter((channel) => channel.views !== null || channel.engagements !== null);
  if (measuredChannels.length >= 2) {
    const ranked = [...measuredChannels].sort((a, b) => (b.views ?? b.engagements ?? -1) - (a.views ?? a.engagements ?? -1));
    const leader = ranked[0]!;
    const trailing = ranked[ranked.length - 1]!;
    if (leader.platform !== trailing.platform) {
      opportunities.push({
        id: intelligenceRecordId('opportunity', input.productId, 'platform', leader.platform),
        productId: input.productId,
        kind: 'platform',
        title: `${leader.platform} is outperforming ${trailing.platform} on measured metrics`,
        recommendation: `Compare formats from ${leader.platform} before adding volume on ${trailing.platform}. Unsupported platform metrics stay unavailable.`,
        evidenceIds: [leader.platform, trailing.platform],
        status: 'proposed',
      });
    }
  }
  const strong = input.learnings.find((learning) => learning.strength !== 'insufficient' && (learning.effectPercent ?? 0) > 0);
  if (strong) {
    opportunities.push({
      id: intelligenceRecordId('opportunity', input.productId, 'learning', strong.id),
      productId: input.productId,
      kind: 'learning',
      title: `Repeat ${strong.key}`,
      recommendation: strong.summary,
      evidenceIds: strong.evidencePostIds.slice(0, 8),
      status: 'proposed',
    });
  }
  if (input.weakestAlignmentDimension && input.alignmentCoverage >= 40 && input.alignmentScore !== null && input.alignmentScore < 70) {
    opportunities.push({
      id: intelligenceRecordId('opportunity', input.productId, 'alignment', input.weakestAlignmentDimension.dimension),
      productId: input.productId,
      kind: 'alignment',
      title: `Close the ${input.weakestAlignmentDimension.dimension} gap`,
      recommendation: `${input.weakestAlignmentDimension.dimension} alignment is ${input.weakestAlignmentDimension.score}. Prefer topics and destinations that match the saved audience profile. This is an association with measured mix, not a causal claim.`,
      evidenceIds: [input.weakestAlignmentDimension.dimension],
      status: 'proposed',
    });
  }
  return opportunities.slice(0, input.limit ?? 12);
}

export function applyOpportunityDecisions(
  opportunities: OptimizationOpportunity[],
  stored: Array<{ id: string; status?: string }>,
): OptimizationOpportunity[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  return opportunities.map((item) => {
    const status = byId.get(item.id)?.status;
    if (status === 'accepted' || status === 'dismissed' || status === 'pinned') {
      return { ...item, status };
    }
    return item;
  });
}
