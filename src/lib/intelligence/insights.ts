import { defaultAudienceProfile, type AudienceIntelligenceProfile } from './schemas';
import { rollupSocialPosts, type OverviewPostRow } from './overview-metrics';
import { audienceAlignmentFromProfile, mergeDistributions } from './alignment';
import { recommendPostingWindows } from './timing';
import { applyLearningDecisions, generateBrandLearnings, type LearningPost } from './learnings';
import { applyOpportunityDecisions, generateOpportunities } from './opportunities';
import { detectAudienceDrift, splitSnapshotsByWindow, type DriftSnapshot } from './drift';
import { computeReadiness } from './readiness';
import { mapObjective, measuredObjectiveValues, objectiveInput } from './historical-fit';
import { objectiveMetric } from './statistics';

export type InsightSocialPost = LearningPost & {
  id: string;
  content?: unknown;
  latestMetrics?: LearningPost['latestMetrics'];
};

export type InsightSnapshot = DriftSnapshot & {
  productId?: string | null;
  followers?: number;
};

export type ObjectiveSummary = {
  /** Objective actually used for rankings, windows, and learnings. */
  objective: AudienceIntelligenceProfile['objective'];
  /** Metric family the objective maps to (reach, views, engagements, clicks, ...). */
  metric: string;
  /** The objective saved on the profile; differs from `objective` only during a fallback. */
  requested: AudienceIntelligenceProfile['objective'];
  /** True when no post reports the requested metric and awareness (reach/views) is used instead. */
  fallback: boolean;
};

/**
 * A brand can declare an objective (installs, purchases, leads) that none of
 * its connected platforms report per post. Rather than rendering every
 * ranking empty, statistics fall back to awareness (reach or views) and the
 * page says so explicitly.
 */
export function resolveEffectiveObjective(
  requested: AudienceIntelligenceProfile['objective'],
  posts: InsightSocialPost[],
): { objective: AudienceIntelligenceProfile['objective']; fallback: boolean } {
  if (posts.length === 0 || measuredObjectiveValues(posts, requested).length > 0) {
    return { objective: requested, fallback: false };
  }
  return { objective: 'awareness', fallback: true };
}

function withObjectiveValue(rows: OverviewPostRow[], posts: InsightSocialPost[], objective: string): Array<OverviewPostRow & { objectiveValue: number | null }> {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const mapped = mapObjective(objective);
  return rows.map((row) => {
    const post = byId.get(row.id);
    const value = post ? objectiveMetric(mapped, objectiveInput(post.latestMetrics)).value : null;
    return { ...row, objectiveValue: value };
  });
}

export function buildProductInsights(input: {
  productId: string;
  profile: Partial<AudienceIntelligenceProfile> | null;
  posts: InsightSocialPost[];
  snapshots: InsightSnapshot[];
  storedLearnings?: Array<{ id: string; status?: string }>;
  storedOpportunities?: Array<{ id: string; status?: string }>;
  nowMs?: number;
  contentLimit?: number;
}) {
  const profile = defaultAudienceProfile(input.profile || {});
  const effective = resolveEffectiveObjective(profile.objective, input.posts);
  const objectiveKey = effective.objective;
  const rollup = rollupSocialPosts(input.posts.map((post) => ({
    ...post,
    latestMetrics: post.latestMetrics ?? undefined,
  })), { contentLimit: input.contentLimit });
  const timing = recommendPostingWindows({
    posts: input.posts,
    timeZone: profile.primaryTimezone,
    objective: objectiveKey,
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
      objective: objectiveKey,
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
  const readiness = computeReadiness({
    posts: input.posts,
    channels: rollup.channels,
    measured: rollup.measured,
    coverage: rollup.coverage,
    timeZone: profile.primaryTimezone,
    objective: objectiveKey,
    alignmentAvailable: Object.keys(actual).length > 0,
  });
  const objective: ObjectiveSummary = {
    objective: objectiveKey,
    metric: timing.metric,
    requested: profile.objective,
    fallback: effective.fallback,
  };
  return {
    profile,
    rollup: {
      ...rollup,
      topContent: withObjectiveValue(rollup.topContent, input.posts, objectiveKey),
      measuredPosts: withObjectiveValue(rollup.measuredPosts, input.posts, objectiveKey),
    },
    timing,
    alignment,
    weakestAlignmentDimension: weakest,
    drift,
    learnings,
    opportunities,
    readiness,
    objective,
  };
}

export type ProductInsights = ReturnType<typeof buildProductInsights>;
