import type { EvergreenCandidate } from './candidates';
import type { evergreenMetricKeys } from './eligibility';

export type EvergreenMetric = typeof evergreenMetricKeys[number];

export function candidateMetric(candidate: EvergreenCandidate, channel: string, metric: EvergreenMetric): number | null {
  return candidate.assessment.observations.find((row) => row.channel === channel)?.metrics[metric] ?? null;
}

/** Rank recorded counts on one channel without inferring suitability or a benchmark result. */
export function filterEvergreenCandidates(candidates: EvergreenCandidate[], {
  channel, metric, query,
}: { channel: string; metric: EvergreenMetric | null; query: string }): EvergreenCandidate[] {
  const search = query.trim().toLowerCase();
  return candidates.filter((candidate) => {
    if (search && !candidate.content.toLowerCase().includes(search) && !candidate.channels.some((name) => name.includes(search))) return false;
    if (channel && !candidate.channels.includes(channel)) return false;
    if (metric && (!channel || candidateMetric(candidate, channel, metric) === null)) return false;
    return true;
  }).sort((a, b) => {
    if (metric) {
      const difference = candidateMetric(b, channel, metric)! - candidateMetric(a, channel, metric)!;
      if (difference) return difference;
    }
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id);
  });
}
