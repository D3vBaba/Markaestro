import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { AudienceFitAssessment } from './audience-fit';
import { bayesianSmoothedPerformance, objectiveMetric, type ObjectiveMetricInput } from './statistics';
import type { BusinessObjective } from './schemas';

export type HistoricalPost = {
  publishedAt?: string | null;
  latestMetrics?: Partial<NormalizedPostMetrics> | null;
};

export function mapObjective(objective: string | undefined): Parameters<typeof objectiveMetric>[0] {
  if (objective === 'website_traffic') return 'traffic';
  if (objective === 'app_installs') return 'installs';
  if (objective === 'other') return 'custom';
  if (
    objective === 'awareness'
    || objective === 'engagement'
    || objective === 'followers'
    || objective === 'leads'
    || objective === 'purchases'
  ) {
    return objective;
  }
  return 'awareness';
}

/**
 * Human-facing metric family an objective optimizes. Awareness reports reach
 * when any post carries it (objectiveMetric prefers reach per post) and views
 * otherwise; conversion-style objectives all resolve to conversions.
 */
export function objectiveMetricFamily(objective: string | undefined, posts: HistoricalPost[] = []): string {
  const mapped = mapObjective(objective);
  if (mapped === 'awareness') {
    // objectiveMetric prefers reach per post; label by whichever is reported
    // for more posts so the name matches what most of the ranking uses.
    const reach = posts.filter((post) => typeof post.latestMetrics?.reach === 'number').length;
    const views = posts.filter((post) => typeof post.latestMetrics?.views === 'number').length;
    return reach > 0 && reach >= views ? 'reach' : 'views';
  }
  if (mapped === 'engagement') return 'engagements';
  if (mapped === 'followers') return 'followers_gained';
  if (mapped === 'traffic') return 'clicks';
  if (mapped === 'custom') return 'conversions';
  return mapped;
}

export function objectiveInput(metrics: Partial<NormalizedPostMetrics> | null | undefined): ObjectiveMetricInput {
  const likes = typeof metrics?.likes === 'number' ? metrics.likes : null;
  const comments = typeof metrics?.comments === 'number' ? metrics.comments : null;
  const shares = typeof metrics?.shares === 'number' ? metrics.shares : null;
  const saves = typeof metrics?.saves === 'number' ? metrics.saves : null;
  const engagements = [likes, comments, shares, saves].some((value) => value !== null)
    ? (likes ?? 0) + (comments ?? 0) + (shares ?? 0) + (saves ?? 0)
    : null;
  return {
    reach: typeof metrics?.reach === 'number' ? metrics.reach : null,
    views: typeof metrics?.views === 'number' ? metrics.views : null,
    engagements,
    followersGained: typeof metrics?.followersGained === 'number' ? metrics.followersGained : null,
    clicks: typeof metrics?.clicks === 'number' ? metrics.clicks : null,
    conversions: typeof metrics?.conversions === 'number' ? metrics.conversions : null,
  };
}

export function measuredObjectiveValues(posts: HistoricalPost[], objective: BusinessObjective | string | undefined): number[] {
  const mapped = mapObjective(objective);
  return posts
    .map((post) => objectiveMetric(mapped, objectiveInput(post.latestMetrics)).value)
    .filter((value): value is number => value !== null);
}

export function hourBucket(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const hour = parts.find((part) => part.type === 'hour')?.value;
    return weekday && hour != null ? `${weekday}-${hour}` : null;
  } catch {
    return null;
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Historical fit is available at five relevant posts with a measured objective metric. */
export function historicalFitAssessment(
  posts: HistoricalPost[],
  objective?: string,
): AudienceFitAssessment {
  const values = measuredObjectiveValues(posts, objective);
  if (values.length < 5) {
    return { component: 'history', score: null, confidence: 0, evidence: [] };
  }
  const peak = Math.max(...values);
  const score = peak > 0 ? Math.round((100 * mean(values)) / peak) : 50;
  return {
    component: 'history',
    score: Math.min(100, Math.max(0, score)),
    confidence: 1,
    evidence: [`${values.length} posts with a measured ${mapObjective(objective)} metric.`],
    recommendation: score < 60
      ? `Historical ${mapObjective(objective)} is well below this account’s measured peak. Reuse the format of the stronger posts.`
      : undefined,
  };
}

/** Account-specific timing requires 20 posts overall and five observations in the cited hour. */
export function timingFitAssessment(input: {
  posts: HistoricalPost[];
  timeZone: string;
  scheduledAt?: string | null;
  objective?: string;
}): AudienceFitAssessment {
  const dated = input.posts.filter((post) => post.publishedAt);
  if (!input.scheduledAt || dated.length < 20) {
    return { component: 'timing', score: null, confidence: 0, evidence: [] };
  }
  const target = hourBucket(input.scheduledAt, input.timeZone);
  if (!target) return { component: 'timing', score: null, confidence: 0, evidence: [] };
  const segment = dated.filter((post) => hourBucket(post.publishedAt!, input.timeZone) === target);
  const overallValues = measuredObjectiveValues(dated, input.objective);
  const segmentValues = measuredObjectiveValues(segment, input.objective);
  if (segment.length < 5 || segmentValues.length < 5 || overallValues.length < 5) {
    return { component: 'timing', score: null, confidence: 0, evidence: [] };
  }
  const overallMean = mean(overallValues);
  const smoothed = bayesianSmoothedPerformance({
    observedMean: mean(segmentValues),
    observations: segmentValues.length,
    priorMean: overallMean,
  });
  const score = overallMean > 0
    ? Math.round(Math.min(100, Math.max(0, 50 + (50 * (smoothed.estimate - overallMean)) / overallMean)))
    : 50;
  return {
    component: 'timing',
    score,
    confidence: 1,
    evidence: [`${segmentValues.length} posts in ${target} (${input.timeZone}) versus ${overallValues.length} account posts.`],
    recommendation: score < 50
      ? `This weekday/hour underperforms the account baseline. Shift toward a stronger window.`
      : undefined,
  };
}
