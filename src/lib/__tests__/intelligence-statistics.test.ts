import { describe, expect, it } from 'vitest';
import {
  calculateAudienceAlignment,
  distributionAlignment,
  evaluateExperiment,
  learningStrength,
  objectiveMetric,
  shouldCreateDriftAlert,
} from '@/lib/intelligence/statistics';

describe('intelligence statistics', () => {
  it('calculates total-variation alignment', () => {
    expect(distributionAlignment({ us: 80, ca: 20 }, { us: 60, ca: 40 })).toBe(80);
  });

  it('renormalizes alignment across available dimensions and reports coverage', () => {
    const result = calculateAudienceAlignment({
      target: { geography: { us: 1 }, age: { '25-34': 1 } },
      actual: { geography: { us: 1 }, age: { '25-34': 0.5, '35-44': 0.5 } },
    });
    expect(result.coverage).toBe(75);
    expect(result.score).toBe(83);
  });

  it('does not fabricate a rate without a denominator', () => {
    expect(objectiveMetric('traffic', { clicks: 12 }).rate).toBeNull();
    expect(objectiveMetric('traffic', { clicks: 12, reach: 120 }).rate).toBe(0.1);
  });

  it('enforces evidence thresholds for learnings and drift', () => {
    expect(learningStrength(4, true)).toBe('insufficient');
    expect(learningStrength(30, true)).toBe('potentially_strong');
    expect(shouldCreateDriftAlert({ coverage: 40, alignmentDeclinePoints: 10, distributionShiftPoints: 0, minimumCohortMet: true, confirmedSnapshots: 2 })).toBe(true);
    expect(shouldCreateDriftAlert({ coverage: 39, alignmentDeclinePoints: 20, distributionShiftPoints: 20, minimumCohortMet: true, confirmedSnapshots: 2 })).toBe(false);
  });

  it('keeps experiments inconclusive until target and confidence thresholds pass', () => {
    const result = evaluateExperiment({
      armA: [10, 10, 11, 9, 10, 10, 11, 9],
      armB: [14, 15, 16, 14, 15, 16, 15, 14],
      targetSamplePerArm: 8,
      iterations: 1000,
    });
    expect(result.status).toBe('winner_b');
    expect(result.confidenceInterval?.[0]).toBeGreaterThan(0);
  });

  it('evaluates paired 1v1 experiments with a single sample per arm', () => {
    const result = evaluateExperiment({
      armA: [100],
      armB: [140],
      targetSamplePerArm: 1,
    });
    expect(result.status).toBe('winner_b');
    expect(result.effectPercent).toBeGreaterThan(0);
  });
});
