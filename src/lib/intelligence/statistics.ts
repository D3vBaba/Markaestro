export type Distribution = Record<string, number>;

function normalized(values: Distribution): Distribution | null {
  const entries = Object.entries(values).filter(([, value]) => Number.isFinite(value) && value >= 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return null;
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

/** 100 × (1 − total variation distance), clamped to the display range. */
export function distributionAlignment(target: Distribution, actual: Distribution): number | null {
  const a = normalized(target);
  const b = normalized(actual);
  if (!a || !b) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const distance = [...keys].reduce((sum, key) => sum + Math.abs((a[key] || 0) - (b[key] || 0)), 0) / 2;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - distance))));
}

export const defaultAlignmentWeights = {
  geography: 50,
  age: 25,
  gender: 15,
  industryInterests: 10,
} as const;

export function calculateAudienceAlignment(input: {
  target: Partial<Record<keyof typeof defaultAlignmentWeights, Distribution>>;
  actual: Partial<Record<keyof typeof defaultAlignmentWeights, Distribution>>;
}): { score: number | null; coverage: number; dimensions: Record<string, number | null> } {
  const dimensions: Record<string, number | null> = {};
  let measuredWeight = 0;
  let weighted = 0;
  for (const [dimension, weight] of Object.entries(defaultAlignmentWeights)) {
    const key = dimension as keyof typeof defaultAlignmentWeights;
    const score = input.target[key] && input.actual[key]
      ? distributionAlignment(input.target[key]!, input.actual[key]!)
      : null;
    dimensions[dimension] = score;
    if (score !== null) {
      measuredWeight += weight;
      weighted += score * weight;
    }
  }
  return {
    score: measuredWeight ? Math.round(weighted / measuredWeight) : null,
    coverage: measuredWeight,
    dimensions,
  };
}

export type ObjectiveMetricInput = {
  reach?: number | null;
  views?: number | null;
  engagements?: number | null;
  followersGained?: number | null;
  clicks?: number | null;
  conversions?: number | null;
};

export function objectiveMetric(
  objective: 'awareness' | 'engagement' | 'followers' | 'traffic' | 'leads' | 'installs' | 'purchases' | 'custom',
  values: ObjectiveMetricInput,
): { metric: string; value: number | null; rate: number | null; denominator: string | null } {
  if (objective === 'awareness') {
    return { metric: values.reach !== null && values.reach !== undefined ? 'reach' : 'views', value: values.reach ?? values.views ?? null, rate: null, denominator: null };
  }
  if (objective === 'engagement') {
    const denominator = values.reach ?? null;
    return { metric: 'engagements', value: values.engagements ?? null, rate: denominator && values.engagements !== null && values.engagements !== undefined ? values.engagements / denominator : null, denominator: denominator ? 'reach' : null };
  }
  if (objective === 'followers') return { metric: 'followers_gained', value: values.followersGained ?? null, rate: null, denominator: null };
  if (objective === 'traffic') {
    const denominator = values.reach ?? values.views ?? null;
    return { metric: 'clicks', value: values.clicks ?? null, rate: denominator && values.clicks !== null && values.clicks !== undefined ? values.clicks / denominator : null, denominator: denominator ? (values.reach != null ? 'reach' : 'views') : null };
  }
  const denominator = values.clicks ?? null;
  return { metric: objective === 'custom' ? 'conversions' : objective, value: values.conversions ?? null, rate: denominator && values.conversions !== null && values.conversions !== undefined ? values.conversions / denominator : null, denominator: denominator ? 'clicks' : null };
}

export function bayesianSmoothedPerformance(input: {
  observedMean: number;
  observations: number;
  priorMean: number;
  priorStrength?: number;
}): { estimate: number; accountSpecific: boolean } {
  const priorStrength = Math.max(1, input.priorStrength ?? 5);
  const observations = Math.max(0, input.observations);
  return {
    estimate: ((input.observedMean * observations) + (input.priorMean * priorStrength)) / (observations + priorStrength),
    accountSpecific: observations >= 5,
  };
}

export function learningStrength(observations: number, varianceSupportsClaim: boolean): 'insufficient' | 'directional' | 'moderate' | 'potentially_strong' {
  if (observations < 5) return 'insufficient';
  if (observations < 15) return 'directional';
  if (observations < 30 || !varianceSupportsClaim) return 'moderate';
  return 'potentially_strong';
}

export function shouldCreateDriftAlert(input: {
  coverage: number;
  alignmentDeclinePoints: number;
  distributionShiftPoints: number;
  minimumCohortMet: boolean;
  confirmedSnapshots: number;
}): boolean {
  return input.coverage >= 40
    && input.minimumCohortMet
    && input.confirmedSnapshots >= 2
    && (input.alignmentDeclinePoints >= 10 || input.distributionShiftPoints >= 8);
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function meanDifferencePercent(treatment: number[], control: number[]): number | null {
  if (treatment.length === 0 || control.length === 0) return null;
  const controlMean = mean(control);
  if (controlMean === 0) return null;
  return ((mean(treatment) - controlMean) / Math.abs(controlMean)) * 100;
}

/** 95% bootstrap interval for the percent difference of two measured samples. */
export function bootstrapMeanDifferencePercent(
  treatment: number[],
  control: number[],
  iterations = 2000,
  seed = 20260825,
): [number, number] | null {
  if (treatment.length < 2 || control.length < 2) return null;
  const random = seededRandom(seed);
  const effects: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampleT = Array.from({ length: treatment.length }, () => treatment[Math.floor(random() * treatment.length)]!);
    const sampleC = Array.from({ length: control.length }, () => control[Math.floor(random() * control.length)]!);
    const effect = meanDifferencePercent(sampleT, sampleC);
    if (effect !== null) effects.push(effect);
  }
  if (effects.length < 20) return null;
  effects.sort((a, b) => a - b);
  return [
    effects[Math.floor(effects.length * 0.025)] ?? null,
    effects[Math.floor(effects.length * 0.975)] ?? null,
  ].every((value) => value !== null)
    ? [effects[Math.floor(effects.length * 0.025)]!, effects[Math.floor(effects.length * 0.975)]!]
    : null;
}

export function evaluateExperiment(input: {
  armA: number[];
  armB: number[];
  targetSamplePerArm: number;
  iterations?: number;
  seed?: number;
}): {
  status: 'winner_a' | 'winner_b' | 'inconclusive';
  effectPercent: number | null;
  confidenceInterval: [number, number] | null;
} {
  const { armA, armB } = input;
  const minSample = Math.max(1, input.targetSamplePerArm);
  if (armA.length < minSample || armB.length < minSample) {
    return { status: 'inconclusive', effectPercent: null, confidenceInterval: null };
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const aMean = mean(armA);
  const bMean = mean(armB);
  if (aMean === 0) return { status: 'inconclusive', effectPercent: null, confidenceInterval: null };
  const effectPercent = ((bMean - aMean) / Math.abs(aMean)) * 100;

  // Paired 1v1 experiments (one post per arm): compare point estimates with the
  // same 15% effect gate, without requiring a bootstrap interval.
  if (armA.length === 1 && armB.length === 1 && minSample === 1) {
    const meaningful = Math.abs(effectPercent) >= 15;
    return {
      status: meaningful ? (effectPercent > 0 ? 'winner_b' : 'winner_a') : 'inconclusive',
      effectPercent,
      confidenceInterval: null,
    };
  }

  const random = seededRandom(input.seed ?? 20260825);
  const effects: number[] = [];
  for (let iteration = 0; iteration < (input.iterations ?? 2000); iteration += 1) {
    const sampleA = Array.from({ length: armA.length }, () => armA[Math.floor(random() * armA.length)]!);
    const sampleB = Array.from({ length: armB.length }, () => armB[Math.floor(random() * armB.length)]!);
    const sampleAMean = mean(sampleA);
    if (sampleAMean !== 0) effects.push(((mean(sampleB) - sampleAMean) / Math.abs(sampleAMean)) * 100);
  }
  effects.sort((a, b) => a - b);
  const interval: [number, number] = [
    effects[Math.floor(effects.length * 0.025)] ?? effectPercent,
    effects[Math.floor(effects.length * 0.975)] ?? effectPercent,
  ];
  const targetMet = armA.length >= input.targetSamplePerArm && armB.length >= input.targetSamplePerArm;
  const meaningful = Math.abs(effectPercent) >= 15;
  const excludesZero = interval[0] > 0 || interval[1] < 0;
  return {
    status: targetMet && meaningful && excludesZero ? (effectPercent > 0 ? 'winner_b' : 'winner_a') : 'inconclusive',
    effectPercent,
    confidenceInterval: interval,
  };
}
