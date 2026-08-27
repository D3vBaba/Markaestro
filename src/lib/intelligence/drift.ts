import { distributionAlignment, shouldCreateDriftAlert } from './statistics';
import {
  audienceAlignmentFromProfile,
  mergeDistributions,
  type AlignmentDistributions,
} from './alignment';
import type { AudienceIntelligenceProfile } from './schemas';
import { intelligenceRecordId } from './record-id';

export type DriftSnapshot = {
  date: string;
  distributions?: AlignmentDistributions | null;
};

export type AudienceDriftEvent = {
  id: string;
  productId: string;
  title: string;
  summary: string;
  coverage: number;
  alignmentDeclinePoints: number;
  distributionShiftPoints: number;
  confirmedSnapshots: number;
  associationOnly: true;
};

function maxShift(recent: AlignmentDistributions, baseline: AlignmentDistributions): number {
  let max = 0;
  for (const key of ['geography', 'age', 'gender', 'industryInterests'] as const) {
    if (!recent[key] || !baseline[key]) continue;
    const score = distributionAlignment(baseline[key]!, recent[key]!);
    if (score === null) continue;
    max = Math.max(max, 100 - score);
  }
  return max;
}

export function detectAudienceDrift(input: {
  productId: string;
  profile: Pick<AudienceIntelligenceProfile, 'targetMarkets' | 'ageBands' | 'genderFocus' | 'industries' | 'interests'>;
  recent: DriftSnapshot[];
  baseline: DriftSnapshot[];
  nowIso?: string;
}): AudienceDriftEvent | null {
  const recentActual = mergeDistributions(input.recent.map((row) => row.distributions || {}));
  const baselineActual = mergeDistributions(input.baseline.map((row) => row.distributions || {}));
  const recentAlignment = audienceAlignmentFromProfile({ profile: input.profile, actual: recentActual });
  const baselineAlignment = audienceAlignmentFromProfile({ profile: input.profile, actual: baselineActual });
  if (recentAlignment.score === null || baselineAlignment.score === null) return null;
  const alignmentDeclinePoints = Math.max(0, baselineAlignment.score - recentAlignment.score);
  const distributionShiftPoints = maxShift(recentActual, baselineActual);
  const coverage = Math.min(recentAlignment.coverage, baselineAlignment.coverage);
  const confirmedSnapshots = Math.min(input.recent.length, input.baseline.length);
  const alert = shouldCreateDriftAlert({
    coverage,
    alignmentDeclinePoints,
    distributionShiftPoints,
    minimumCohortMet: input.recent.length >= 5 && input.baseline.length >= 5,
    confirmedSnapshots,
  });
  if (!alert) return null;
  return {
    id: intelligenceRecordId('drift', input.productId, (input.nowIso || '').slice(0, 10)),
    productId: input.productId,
    title: 'Audience mix shifted relative to the prior window',
    summary: `Alignment moved ${alignmentDeclinePoints} points and the largest measurable distribution shift was ${Math.round(distributionShiftPoints)} points. This is an association across two snapshot windows, not a cause.`,
    coverage,
    alignmentDeclinePoints,
    distributionShiftPoints,
    confirmedSnapshots,
    associationOnly: true,
  };
}

export function splitSnapshotsByWindow(
  snapshots: DriftSnapshot[],
  nowMs = Date.now(),
): { recent: DriftSnapshot[]; baseline: DriftSnapshot[] } {
  const day = 24 * 60 * 60_000;
  const recent: DriftSnapshot[] = [];
  const baseline: DriftSnapshot[] = [];
  for (const snapshot of snapshots) {
    const at = Date.parse(`${snapshot.date}T00:00:00Z`);
    if (!Number.isFinite(at)) continue;
    const age = nowMs - at;
    if (age <= 7 * day) recent.push(snapshot);
    else if (age <= 28 * day) baseline.push(snapshot);
  }
  return { recent, baseline };
}
