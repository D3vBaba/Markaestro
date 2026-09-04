import { describe, expect, it } from 'vitest';
import { rankEvergreenCandidates } from './candidates';

const now = new Date('2026-09-03T12:00:00Z');
const old = '2026-08-01T10:00:00Z';

function post(id: string, extra: Record<string, unknown>) {
  return { id, status: 'published', channel: 'instagram', publishedAt: old, content: id, ...extra };
}

describe('rankEvergreenCandidates', () => {
  it('puts eligible posts first, ranked by engagement rate, and marks the top ones suggested', () => {
    const rows = rankEvergreenCandidates([
      post('low', { metrics: { views: 1000, likes: 5 } }),
      post('high', { metrics: { views: 100, likes: 20, comments: 5 } }),
      post('fresh', { publishedAt: '2026-09-02T10:00:00Z', metrics: { views: 5000, likes: 900 } }),
      post('silent', {}),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(['high', 'low', 'fresh', 'silent']);
    expect(rows[0]).toMatchObject({ eligible: true, suggested: true, engagements: 25, views: 100 });
    expect(rows[2]).toMatchObject({ eligible: false, suggested: false, reasons: ['SOURCE_METRICS_IMMATURE'] });
    expect(rows[3].reasons).toContain('SOURCE_HAS_NO_MEASURED_SIGNAL');
  });

  it('falls back to raw engagement when views are not measured', () => {
    const rows = rankEvergreenCandidates([
      post('a', { metrics: { likes: 3 } }),
      post('b', { metrics: { likes: 30 } }),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0].engagementRate).toBeNull();
  });
});
