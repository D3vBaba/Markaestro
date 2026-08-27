import { defaultAudienceProfile, type AudienceIntelligenceProfile } from './schemas';
import { rollupSocialPosts } from './overview-metrics';
import { audienceAlignmentFromProfile, mergeDistributions, type AlignmentDistributions } from './alignment';
import { recommendPostingWindows } from './timing';
import { applyLearningDecisions, generateBrandLearnings, type LearningPost } from './learnings';
import { applyOpportunityDecisions, generateOpportunities } from './opportunities';
import { detectAudienceDrift, splitSnapshotsByWindow, type DriftSnapshot } from './drift';

export type InsightSocialPost = LearningPost & {
  id: string;
  content?: unknown;
  latestMetrics?: LearningPost['latestMetrics'];
};

export type InsightSnapshot = DriftSnapshot & {
  productId?: string | null;
  followers?: number;
};

export function buildProductInsights(input: {
  productId: string;
  profile: Partial<AudienceIntelligenceProfile> | null;
  posts: InsightSocialPost[];
  snapshots: InsightSnapshot[];
  storedLearnings?: Array<{ id: string; status?: string }>;
  storedOpportunities?: Array<{ id: string; status?: string }>;
  nowMs?: number;
}) {
  const profile = defaultAudienceProfile(input.profile || {});
  const rollup = rollupSocialPosts(input.posts.map((post) => ({
    ...post,
    latestMetrics: post.latestMetrics ?? undefined,
  })));
  const timing = recommendPostingWindows({
    posts: input.posts,
    timeZone: profile.primaryTimezone,
    objective: profile.objective,
  });
  const actual = mergeDistributions(
    input.snapshots.map((snapshot) => snapshot.distributions || {}),
  );
  const alignment = audienceAlignmentFromProfile({ profile, actual });
  const weakest = Object.entries(alignment.dimensions)
    .filter(([, score]) => score !== null)
    .map(([dimension, score]) => ({ dimension, score: score as number }))
    .sort((a, b) => a.score - b.score)[0] || null;
  const { recent, baseline } = splitSnapshotsByWindow(input.snapshots, input.nowMs);
  const drift = detectAudienceDrift({
    productId: input.productId,
    profile,
    recent,
    baseline,
    nowIso: new Date(input.nowMs ?? Date.now()).toISOString(),
  });
  const learnings = applyLearningDecisions(
    generateBrandLearnings({
      productId: input.productId,
      posts: input.posts,
      timeZone: profile.primaryTimezone,
      objective: profile.objective,
    }),
    input.storedLearnings || [],
  );
  const opportunities = applyOpportunityDecisions(
    generateOpportunities({
      productId: input.productId,
      timing,
      channels: rollup.channels,
      learnings: learnings.filter((item) => item.status !== 'dismissed'),
      alignmentScore: alignment.score,
      alignmentCoverage: alignment.coverage,
      weakestAlignmentDimension: weakest,
    }),
    input.storedOpportunities || [],
  );
  return {
    profile,
    rollup,
    timing,
    alignment,
    weakestAlignmentDimension: weakest,
    drift,
    learnings,
    opportunities,
  };
}
