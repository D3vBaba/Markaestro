import { describe, expect, it } from 'vitest';
import { evaluateEvergreenEligibility } from './eligibility';

const now = new Date('2026-09-03T12:00:00.000Z');

describe('evergreen eligibility', () => {
  it('captures immutable evidence for a mature published post', () => {
    const result = evaluateEvergreenEligibility({
      status: 'published',
      publishedAt: '2026-08-20T12:00:00.000Z',
      targetChannels: ['x', 'linkedin'],
      metricsByChannel: {
        x: { likes: 8, comments: 1, shares: 2, impressions: 600 },
        linkedin: { likes: 6, comments: 2, shares: 0, impressions: 400 },
      },
    }, now);

    expect(result.eligible).toBe(true);
    expect(result.channels).toEqual(['x', 'linkedin']);
    expect(result.evidence).toMatchObject({ metric: 'engagements', value: 19, sampleSize: 1000 });
  });

  it('rejects immature, unmeasured, and unknown-channel sources', () => {
    const result = evaluateEvergreenEligibility({
      status: 'draft',
      publishedAt: '2026-09-01T12:00:00.000Z',
      channel: 'unknown',
      metrics: {},
    }, now);

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      'SOURCE_NOT_PUBLISHED',
      'SOURCE_METRICS_IMMATURE',
      'SOURCE_HAS_NO_MEASURED_SIGNAL',
      'SOURCE_HAS_NO_CHANNEL',
    ]);
  });
});
