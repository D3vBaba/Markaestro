import { intelligenceRecordId } from './record-id';
import type { TimingRecommendation } from './timing';
import type { BrandLearning } from './learnings';
import type { OverviewChannelRow } from './overview-metrics';

export const PLATFORM_COMPARISON_MIN_POSTS = 5;

export type OpportunityKind = 'timing' | 'platform' | 'learning' | 'alignment';

/**
 * Structured evidence the client renders in the viewer's language. The stored
 * English `title` / `recommendation` remain for the strategist and inbox.
 */
export type OpportunityParams =
  | {
    kind: 'timing';
    weekday: string;
    hour: string;
    timeZone: string;
    observations: number;
    estimate: number | null;
    liftPercent: number | null;
    metric: string;
  }
  | {
    kind: 'platform';
    leader: string;
    trailing: string;
    metric: 'views' | 'engagements';
    leaderPerPost: number;
    trailingPerPost: number;
    leaderPosts: number;
    trailingPosts: number;
  }
  | {
    kind: 'learning';
    learningId: string;
    dimension: BrandLearning['dimension'];
    key: string;
    metric: string;
    effectPercent: number | null;
    observations: number;
  }
  | {
    kind: 'alignment';
    dimension: string;
    score: number;
  };

export type OptimizationOpportunity = {
  id: string;
  productId: string;
  title: string;
  recommendation: string;
  kind: OpportunityKind;
  params: OpportunityParams;
  evidenceIds: string[];
  status: 'proposed' | 'accepted' | 'dismissed' | 'pinned';
};

type ComparableChannel = {
  platform: string;
  metric: 'views' | 'engagements';
  perPost: number;
  measured: number;
};

/**
 * Per-post comparison on a shared metric so a platform with more posts does
 * not "win" on volume alone. Views are preferred; engagements are the fallback
 * when fewer than two platforms report views. Channel rows written before
 * measured counts existed fall back to treating every post as measured.
 */
export function comparablePlatforms(channels: OverviewChannelRow[]): ComparableChannel[] {
  const build = (metric: 'views' | 'engagements'): ComparableChannel[] => channels.flatMap((channel) => {
    const total = metric === 'views' ? channel.views : channel.engagements;
    if (total === null || total === undefined) return [];
    const measured = metric === 'views'
      ? (channel.measuredViews ?? channel.posts)
      : (channel.measuredEngagements ?? channel.posts);
    if (measured < PLATFORM_COMPARISON_MIN_POSTS) return [];
    const perPost = metric === 'views'
      ? (channel.avgViews ?? total / measured)
      : (channel.avgEngagements ?? total / measured);
    return [{ platform: channel.platform, metric, perPost, measured }];
  });
  const byViews = build('views');
  if (byViews.length >= 2) return byViews.sort((a, b) => b.perPost - a.perPost);
  return build('engagements').sort((a, b) => b.perPost - a.perPost);
}

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
      recommendation: `This weekday/hour has ${bestWindow.observations} measured posts and the strongest account-specific estimate on ${input.timing.metric}.`,
      params: {
        kind: 'timing',
        weekday: bestWindow.weekday,
        hour: bestWindow.hour,
        timeZone: input.timing.timeZone,
        observations: bestWindow.observations,
        estimate: bestWindow.estimate,
        liftPercent: bestWindow.liftPercent,
        metric: input.timing.metric,
      },
      evidenceIds: [bestWindow.bucket],
      status: 'proposed',
    });
  }
  const ranked = comparablePlatforms(input.channels);
  if (ranked.length >= 2) {
    const leader = ranked[0]!;
    const trailing = ranked[ranked.length - 1]!;
    if (leader.platform !== trailing.platform && leader.perPost > trailing.perPost) {
      opportunities.push({
        id: intelligenceRecordId('opportunity', input.productId, 'platform', leader.platform),
        productId: input.productId,
        kind: 'platform',
        title: `${leader.platform} is outperforming ${trailing.platform} per post`,
        recommendation: `${leader.platform} averages ${Math.round(leader.perPost)} ${leader.metric} per post across ${leader.measured} measured posts versus ${Math.round(trailing.perPost)} on ${trailing.platform} (${trailing.measured} posts). Reuse what works on ${leader.platform} before adding volume on ${trailing.platform}.`,
        params: {
          kind: 'platform',
          leader: leader.platform,
          trailing: trailing.platform,
          metric: leader.metric,
          leaderPerPost: leader.perPost,
          trailingPerPost: trailing.perPost,
          leaderPosts: leader.measured,
          trailingPosts: trailing.measured,
        },
        evidenceIds: [leader.platform, trailing.platform],
        status: 'proposed',
      });
    }
  }
  const strong = [...input.learnings]
    .sort((a, b) => (a.dimension === 'timing' ? 1 : 0) - (b.dimension === 'timing' ? 1 : 0))
    .find((learning) => learning.strength !== 'insufficient' && (learning.effectPercent ?? 0) > 0);
  if (strong) {
    opportunities.push({
      id: intelligenceRecordId('opportunity', input.productId, 'learning', strong.id),
      productId: input.productId,
      kind: 'learning',
      title: `Repeat ${strong.key}`,
      recommendation: strong.summary,
      params: {
        kind: 'learning',
        learningId: strong.id,
        dimension: strong.dimension,
        key: strong.key,
        metric: strong.metric,
        effectPercent: strong.effectPercent,
        observations: strong.observations,
      },
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
      params: {
        kind: 'alignment',
        dimension: input.weakestAlignmentDimension.dimension,
        score: input.weakestAlignmentDimension.score,
      },
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
