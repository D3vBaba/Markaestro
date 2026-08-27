import { describe, expect, it } from 'vitest';
import { calculateAudienceFit } from '@/lib/intelligence/audience-fit';

describe('calculateAudienceFit', () => {
  it('uses deterministic platform weights', () => {
    const result = calculateAudienceFit({
      platform: 'tiktok',
      assessments: [
        { component: 'audience', score: 80, confidence: 0.8, evidence: ['target topic'] },
        { component: 'hook', score: 100, confidence: 0.9, evidence: ['question first'] },
        { component: 'format', score: 50, confidence: 0.8, evidence: ['short video'] },
        { component: 'history', score: 60, confidence: 1, evidence: ['10 posts'] },
        { component: 'timing', score: 70, confidence: 1, evidence: ['evening window'] },
        { component: 'cta', score: 40, confidence: 0.7, evidence: ['late CTA'] },
      ],
      historicalSampleSize: 10,
      timingOverallSampleSize: 30,
      timingSegmentSampleSize: 6,
    });
    expect(result.score).toBe(73);
    expect(result.dataCoverage).toBe(100);
    expect(result.coldStart).toBe(false);
    expect(result.recommendations[0]).toContain('CTA');
    expect(result.recommendations[0]).toContain('40');
  });

  it('excludes unavailable history and timing without treating them as zero', () => {
    const result = calculateAudienceFit({
      platform: 'instagram',
      assessments: [
        { component: 'audience', score: 80, confidence: 0.8, evidence: [] },
        { component: 'hook', score: 90, confidence: 0.8, evidence: [] },
        { component: 'format', score: 70, confidence: 0.8, evidence: [] },
        { component: 'history', score: 1, confidence: 0.1, evidence: [] },
        { component: 'timing', score: 1, confidence: 0.1, evidence: [] },
        { component: 'cta', score: 60, confidence: 0.8, evidence: [] },
      ],
      historicalSampleSize: 2,
      timingOverallSampleSize: 4,
      timingSegmentSampleSize: 1,
    });
    expect(result.score).toBe(76);
    expect(result.dataCoverage).toBe(70);
    expect(result.coldStart).toBe(true);
    expect(result.components.find((item) => item.component === 'history')?.score).toBeNull();
    expect(result.recommendations[0]).toContain('CTA');
  });

  it('keeps the lowest-scoring measurable component first when AI supplies a recommendation', () => {
    const result = calculateAudienceFit({
      platform: 'facebook',
      assessments: [
        { component: 'audience', score: 90, confidence: 0.8, evidence: ['topic match'], recommendation: 'Keep the audience framing.' },
        { component: 'opening', score: 20, confidence: 0.9, evidence: ['buries the offer'], recommendation: 'Lead with the offer in the first line.' },
        { component: 'format', score: 70, confidence: 0.8, evidence: ['image'] },
        { component: 'history', score: 80, confidence: 1, evidence: ['12 posts'] },
        { component: 'timing', score: 80, confidence: 1, evidence: ['weekday morning'] },
        { component: 'cta', score: 75, confidence: 0.8, evidence: ['clear link'] },
      ],
      historicalSampleSize: 12,
      timingOverallSampleSize: 20,
      timingSegmentSampleSize: 5,
    });
    expect(result.recommendations[0]).toBe('Lead with the offer in the first line.');
  });
});

