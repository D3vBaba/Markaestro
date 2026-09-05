import { describe, expect, it } from 'vitest';
import { rankEvergreenCandidates } from './candidates';
const now = new Date('2026-09-04T12:00:00Z');
function post(id: string, extra: Record<string, unknown> = {}) {
  return { id, status: 'published', channel: 'instagram', publishedAt: '2026-08-01T10:00:00Z', content: id, ...extra };
}
describe('Evergreen candidates', () => {
  it('allows zero recommendations even with many eligible posts', () => {
    const rows = rankEvergreenCandidates(Array.from({ length: 20 }, (_, i) => post(String(i), { metrics: { views: i === 0 ? 9 : 100000, likes: 1000 } })), now);
    expect(rows.every((r) => r.eligible && !r.suggested && r.evidence === null)).toBe(true);
    expect(rows.find((r) => r.id === '0')?.assessment.recommendation).toBe('insufficient_evidence');
  });
  it('browses by availability and recency, without rewarding small-sample rates or raw volume', () => {
    const rows = rankEvergreenCandidates([
      post('large', { metrics: { views: 100000, likes: 9000 } }),
      post('recent', { publishedAt: '2026-09-04T10:00:00Z', metrics: { views: 9 } }),
      post('draft', { status: 'draft' }),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(['recent', 'large', 'draft']);
    expect(rows[0]).toMatchObject({ views: 9, engagementRate: null, suggested: false });
  });
  it('does not substitute impressions for missing views or fabricate a combined engagement count', () => {
    expect(rankEvergreenCandidates([post('a', { metrics: { impressions: 9, likes: 1 } })], now)[0]).toMatchObject({ views: null, engagements: null, engagementRate: null });
  });
});
