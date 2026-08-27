import type { AudienceIntelligenceProfile } from './schemas';
import {
  calculateAudienceAlignment,
  defaultAlignmentWeights,
  type Distribution,
} from './statistics';

export type AlignmentDimension = keyof typeof defaultAlignmentWeights;
export type AlignmentDistributions = Partial<Record<AlignmentDimension, Distribution>>;

export function targetDistributionsFromProfile(
  profile: Pick<AudienceIntelligenceProfile, 'targetMarkets' | 'ageBands' | 'genderFocus' | 'industries' | 'interests'>,
): AlignmentDistributions {
  const target: AlignmentDistributions = {};
  if (profile.targetMarkets.length > 0) {
    target.geography = Object.fromEntries(
      profile.targetMarkets.map((market) => [market.code.toLowerCase(), market.weight]),
    );
  }
  if (profile.ageBands.length > 0) {
    target.age = Object.fromEntries(
      profile.ageBands.map((band) => [`${band.min}-${band.max}`, band.weight ?? 1]),
    );
  }
  const genders = profile.genderFocus.filter((value) => value !== 'all');
  if (genders.length > 0) {
    target.gender = Object.fromEntries(genders.map((value) => [value, 1]));
  }
  const industryInterests = [...profile.industries, ...profile.interests];
  if (industryInterests.length > 0) {
    target.industryInterests = Object.fromEntries(industryInterests.map((value) => [value.toLowerCase(), 1]));
  }
  return target;
}

export function mergeDistributions(rows: AlignmentDistributions[]): AlignmentDistributions {
  const merged: AlignmentDistributions = {};
  for (const key of Object.keys(defaultAlignmentWeights) as AlignmentDimension[]) {
    const combined: Distribution = {};
    for (const row of rows) {
      const distribution = row[key];
      if (!distribution) continue;
      for (const [bucket, value] of Object.entries(distribution)) {
        if (!Number.isFinite(value) || value < 0) continue;
        combined[bucket.toLowerCase()] = (combined[bucket.toLowerCase()] || 0) + value;
      }
    }
    if (Object.keys(combined).length > 0) merged[key] = combined;
  }
  return merged;
}

export function audienceAlignmentFromProfile(input: {
  profile: Pick<AudienceIntelligenceProfile, 'targetMarkets' | 'ageBands' | 'genderFocus' | 'industries' | 'interests'>;
  actual: AlignmentDistributions;
}) {
  return calculateAudienceAlignment({
    target: targetDistributionsFromProfile(input.profile),
    actual: input.actual,
  });
}
