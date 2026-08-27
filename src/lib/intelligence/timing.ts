import { bayesianSmoothedPerformance } from './statistics';
import {
  hourBucket,
  mapObjective,
  measuredObjectiveValues,
  type HistoricalPost,
} from './historical-fit';

export type TimingWindow = {
  bucket: string;
  weekday: string;
  hour: string;
  observations: number;
  estimate: number | null;
  accountSpecific: boolean;
  label: 'measured' | 'unavailable';
};

export type TimingRecommendation = {
  accountSpecific: boolean;
  sampleSize: number;
  metric: string;
  windows: TimingWindow[];
  limitations: string[];
};

/**
 * Rank weekday/hour windows from measured account performance. Account-specific
 * claims require 20 posts overall and five observations in the cited window.
 * Missing industry baselines are not invented.
 */
export function recommendPostingWindows(input: {
  posts: HistoricalPost[];
  timeZone: string;
  objective?: string;
  limit?: number;
}): TimingRecommendation {
  const metric = mapObjective(input.objective);
  const dated = input.posts.filter((post) => post.publishedAt);
  const overallValues = measuredObjectiveValues(dated, input.objective);
  const limitations: string[] = [];
  if (dated.length < 20 || overallValues.length < 5) {
    limitations.push('Account-specific timing needs 20 dated posts and five measured observations.');
    return { accountSpecific: false, sampleSize: overallValues.length, metric, windows: [], limitations };
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
    if (values.length < 5) continue;
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
      accountSpecific: true,
      label: 'measured',
    });
  }
  windows.sort((a, b) => (b.estimate ?? Number.NEGATIVE_INFINITY) - (a.estimate ?? Number.NEGATIVE_INFINITY));
  if (windows.length === 0) {
    limitations.push('No weekday/hour window yet has five measured observations.');
  }
  return {
    accountSpecific: windows.length > 0,
    sampleSize: overallValues.length,
    metric,
    windows: windows.slice(0, input.limit ?? 8),
    limitations,
  };
}
