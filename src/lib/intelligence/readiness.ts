import { measuredObjectiveValues, type HistoricalPost } from './historical-fit';
import { LEARNING_MIN_GROUP, LEARNING_MIN_REST } from './learnings';
import { PLATFORM_COMPARISON_MIN_POSTS } from './opportunities';
import { overviewMetricKeys, type OverviewChannelRow, type OverviewMetricKey } from './overview-metrics';
import { largestWindowObservations, TIMING_MIN_DATED_POSTS, TIMING_MIN_WINDOW_OBSERVATIONS } from './timing';

export const CONTENT_PATTERN_MIN_FINGERPRINTS = LEARNING_MIN_GROUP + LEARNING_MIN_REST;
export const HISTORY_MIN_MEASURED = 5;

export type ReadinessCheckId =
  | 'history'
  | 'timing'
  | 'timingWindow'
  | 'platformComparison'
  | 'learnings'
  | 'contentPatterns'
  | 'alignment';

export type ReadinessCheck = {
  id: ReadinessCheckId;
  met: boolean;
  /** False when no connected platform can supply the input at all. */
  available: boolean;
  current: number;
  required: number;
};

export type IntelligenceReadiness = {
  postsTotal: number;
  postsMeasured: number;
  datedPosts: number;
  objectiveMeasured: number;
  fingerprinted: number;
  platformsMeasured: number;
  largestWindow: number;
  metrics: Record<OverviewMetricKey, { measured: number; coverage: number }>;
  checks: ReadinessCheck[];
};

type ReadinessPost = HistoricalPost & { fingerprint?: unknown };

export function computeReadiness(input: {
  posts: ReadinessPost[];
  channels: OverviewChannelRow[];
  measured: Record<OverviewMetricKey, number>;
  coverage: Record<OverviewMetricKey, number>;
  timeZone: string;
  objective?: string;
  alignmentAvailable: boolean;
}): IntelligenceReadiness {
  const postsTotal = input.posts.length;
  const postsMeasured = input.posts.filter((post) => {
    const metrics = post.latestMetrics || {};
    return Object.values(metrics).some((value) => typeof value === 'number' && Number.isFinite(value));
  }).length;
  const datedPosts = input.posts.filter((post) => Boolean(post.publishedAt)).length;
  const objectiveMeasured = measuredObjectiveValues(input.posts, input.objective).length;
  const fingerprinted = input.posts.filter((post) => post.fingerprint && typeof post.fingerprint === 'object').length;
  const platformsMeasured = input.channels.filter((channel) => {
    const measured = Math.max(channel.measuredViews ?? 0, channel.measuredEngagements ?? 0);
    return measured >= PLATFORM_COMPARISON_MIN_POSTS;
  }).length;
  const largestWindow = largestWindowObservations({
    posts: input.posts,
    timeZone: input.timeZone,
    objective: input.objective,
  });
  const learningsCurrent = Math.min(objectiveMeasured, LEARNING_MIN_GROUP + LEARNING_MIN_REST);
  const checks: ReadinessCheck[] = [
    { id: 'history', available: true, current: Math.min(objectiveMeasured, HISTORY_MIN_MEASURED), required: HISTORY_MIN_MEASURED, met: objectiveMeasured >= HISTORY_MIN_MEASURED },
    // Two conditions; the row shows whichever one is still binding.
    datedPosts >= TIMING_MIN_DATED_POSTS && objectiveMeasured < TIMING_MIN_WINDOW_OBSERVATIONS
      ? { id: 'timing', available: true, current: objectiveMeasured, required: TIMING_MIN_WINDOW_OBSERVATIONS, met: false }
      : { id: 'timing', available: true, current: Math.min(datedPosts, TIMING_MIN_DATED_POSTS), required: TIMING_MIN_DATED_POSTS, met: datedPosts >= TIMING_MIN_DATED_POSTS && objectiveMeasured >= TIMING_MIN_WINDOW_OBSERVATIONS },
    { id: 'timingWindow', available: true, current: Math.min(largestWindow, TIMING_MIN_WINDOW_OBSERVATIONS), required: TIMING_MIN_WINDOW_OBSERVATIONS, met: largestWindow >= TIMING_MIN_WINDOW_OBSERVATIONS },
    { id: 'platformComparison', available: true, current: Math.min(platformsMeasured, 2), required: 2, met: platformsMeasured >= 2 },
    { id: 'learnings', available: true, current: learningsCurrent, required: LEARNING_MIN_GROUP + LEARNING_MIN_REST, met: objectiveMeasured >= LEARNING_MIN_GROUP + LEARNING_MIN_REST },
    { id: 'contentPatterns', available: true, current: Math.min(fingerprinted, CONTENT_PATTERN_MIN_FINGERPRINTS), required: CONTENT_PATTERN_MIN_FINGERPRINTS, met: fingerprinted >= CONTENT_PATTERN_MIN_FINGERPRINTS },
    { id: 'alignment', available: input.alignmentAvailable, current: input.alignmentAvailable ? 1 : 0, required: 1, met: input.alignmentAvailable },
  ];
  return {
    postsTotal,
    postsMeasured,
    datedPosts,
    objectiveMeasured,
    fingerprinted,
    platformsMeasured,
    largestWindow,
    metrics: Object.fromEntries(
      overviewMetricKeys.map((key) => [key, { measured: input.measured[key], coverage: input.coverage[key] }]),
    ) as Record<OverviewMetricKey, { measured: number; coverage: number }>,
    checks,
  };
}
