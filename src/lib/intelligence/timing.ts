import { bayesianSmoothedPerformance } from './statistics';
import {
  hourBucket,
  measuredObjectiveValues,
  objectiveMetricFamily,
  type HistoricalPost,
} from './historical-fit';

export const TIMING_MIN_DATED_POSTS = 20;
export const TIMING_MIN_WINDOW_OBSERVATIONS = 5;

export type TimingLimitation = 'needs_dated_posts' | 'no_window_with_five';

export type TimingWindow = {
  bucket: string;
  weekday: string;
  hour: string;
  observations: number;
  estimate: number | null;
  /** Smoothed estimate relative to the account mean, in percent. */
  liftPercent: number | null;
  accountSpecific: boolean;
  label: 'measured' | 'unavailable';
};

export type TimingRecommendation = {
  accountSpecific: boolean;
  sampleSize: number;
  datedPosts: number;
  metric: string;
  timeZone: string;
  accountMean: number | null;
  windows: TimingWindow[];
  /** Machine-readable reasons the client localizes; never prose. */
  limitations: TimingLimitation[];
};

/**
 * Rank weekday/hour windows from measured account performance. Account-specific
 * claims require 20 dated posts overall and five observations in the cited
 * window. Missing industry baselines are not invented.
 */
export function recommendPostingWindows(input: {
  posts: HistoricalPost[];
  timeZone: string;
  objective?: string;
  limit?: number;
}): TimingRecommendation {
  const metric = objectiveMetricFamily(input.objective, input.posts);
  const dated = input.posts.filter((post) => post.publishedAt);
  const overallValues = measuredObjectiveValues(dated, input.objective);
  const limitations: TimingLimitation[] = [];
  const base = {
    sampleSize: overallValues.length,
    datedPosts: dated.length,
    metric,
    timeZone: input.timeZone,
  };
  if (dated.length < TIMING_MIN_DATED_POSTS || overallValues.length < TIMING_MIN_WINDOW_OBSERVATIONS) {
    limitations.push('needs_dated_posts');
    return { ...base, accountSpecific: false, accountMean: null, windows: [], limitations };
  }
  const overallMean = overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length;
  const grouped = new Map<string, HistoricalPost[]>();
  for (const post of dated) {
    const bucket = hourBucket(post.publishedAt!, input.timeZone);
    if (!bucket) continue;
    const list = grouped.get(bucket) || [];
    list.push(post);
    grouped.set(bucket, list);
  }
  const windows: TimingWindow[] = [];
  for (const [bucket, posts] of grouped) {
    const values = measuredObjectiveValues(posts, input.objective);
    const [weekday, hour] = bucket.split('-');
    if (values.length < TIMING_MIN_WINDOW_OBSERVATIONS) continue;
    const smoothed = bayesianSmoothedPerformance({
      observedMean: values.reduce((sum, value) => sum + value, 0) / values.length,
      observations: values.length,
      priorMean: overallMean,
    });
    windows.push({
      bucket,
      weekday: weekday || bucket,
      hour: hour || '',
      observations: values.length,
      estimate: smoothed.estimate,
      liftPercent: overallMean > 0 ? ((smoothed.estimate - overallMean) / overallMean) * 100 : null,
      accountSpecific: true,
      label: 'measured',
    });
  }
  windows.sort((a, b) => (b.estimate ?? Number.NEGATIVE_INFINITY) - (a.estimate ?? Number.NEGATIVE_INFINITY));
  if (windows.length === 0) {
    limitations.push('no_window_with_five');
  }
  return {
    ...base,
    accountSpecific: windows.length > 0,
    accountMean: overallMean,
    windows: windows.slice(0, input.limit ?? 8),
    limitations,
  };
}

/** Largest number of measured observations in any single weekday/hour window. */
export function largestWindowObservations(input: {
  posts: HistoricalPost[];
  timeZone: string;
  objective?: string;
}): number {
  const grouped = new Map<string, HistoricalPost[]>();
  for (const post of input.posts) {
    if (!post.publishedAt) continue;
    const bucket = hourBucket(post.publishedAt, input.timeZone);
    if (!bucket) continue;
    const list = grouped.get(bucket) || [];
    list.push(post);
    grouped.set(bucket, list);
  }
  let largest = 0;
  for (const posts of grouped.values()) {
    largest = Math.max(largest, measuredObjectiveValues(posts, input.objective).length);
  }
  return largest;
}
