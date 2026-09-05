import { describe, expect, it } from 'vitest';
import { evaluateEvergreenEligibility } from './eligibility';

const now = new Date('2026-09-04T12:00:00Z');
const post = { status: 'published', channel: 'instagram', publishedAt: '2026-09-04T10:00:00Z' };

describe('Evergreen evidence and manual eligibility', () => {
  it.each([{}, { views: 9 }, { views: 9, likes: 8 }, { views: 1000000, likes: 90000 }])('does not endorse a post based on counts: %j', (metrics) => {
    expect(evaluateEvergreenEligibility({ ...post, metrics }, now)).toMatchObject({
      eligible: true, reasons: [], evidence: null, suitability: 'needs_review',
      performance: 'unavailable', recommendation: 'insufficient_evidence',
    });
  });
  it('preserves missing metrics, explicit zeroes, and unavailable fields', () => {
    const result = evaluateEvergreenEligibility({ ...post, metrics: {
      views: 0, impressions: 9, likes: 5, shares: -1, clicks: Infinity,
      availability: { likes: { state: 'missing_scope' } },
    } }, now);
    expect(result.observations[0]).toMatchObject({ capturedAt: null, metrics: {
      views: 0, impressions: 9, likes: null, comments: null, shares: null, clicks: null,
    } });
  });
  it('keeps channels separate and never treats legacy combined counts as channel measurements', () => {
    const result = evaluateEvergreenEligibility({ ...post, targetChannels: ['x', 'linkedin'],
      metrics: { views: 9000 }, metricsByChannel: { x: { views: 9, impressions: 20 } },
    }, now);
    expect(result.observations[0].metrics).toMatchObject({ views: 9, impressions: 20 });
    expect(result.observations[1].metrics.views).toBeNull();
    expect(result.evidence).toBeNull();
  });
  it.each(['invalid', '2026-09-05T00:00:00Z', '2026-09-01T00:00:00Z'])('does not manufacture a measurement time from %s', (measuredAt) => {
    const result = evaluateEvergreenEligibility({ ...post, metrics: { source: { measuredAt } } }, now);
    expect(result.observations[0].capturedAt).toBeNull();
  });
  it('uses the recorded observation time, not evaluation time', () => {
    const measuredAt = '2026-09-04T11:00:00.000Z';
    expect(evaluateEvergreenEligibility({ ...post, metrics: { source: { measuredAt } } }, now).observations[0].capturedAt).toBe(measuredAt);
  });
  it('rejects unavailable sources without adding invented maturity rules', () => {
    expect(evaluateEvergreenEligibility({ status: 'draft', channel: 'unknown' }, now).reasons).toEqual([
      'SOURCE_NOT_PUBLISHED', 'SOURCE_PUBLISH_DATE_MISSING', 'SOURCE_HAS_NO_CHANNEL',
    ]);
    expect(evaluateEvergreenEligibility({ ...post, publishedAt: '2099-01-01' }, now).reasons).toContain('SOURCE_PUBLISH_DATE_FUTURE');
  });
});
