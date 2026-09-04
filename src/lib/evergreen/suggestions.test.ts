import { describe, expect, it } from 'vitest';
import { pickSuggestions } from './suggestions';
import type { EvergreenCandidate } from './candidates';

function row(id: string, extra: Partial<EvergreenCandidate>): EvergreenCandidate {
  return {
    id, content: id, channel: 'instagram', channels: ['instagram'], publishedAt: '2026-08-01T00:00:00Z',
    thumbnailUrl: null, mediaUrl: null, engagements: 0, views: 0, engagementRate: null, eligible: true,
    reasons: [], evidence: null, suggested: true, ...extra,
  };
}

describe('pickSuggestions', () => {
  it('nudges only strong, eligible, unqueued, never-suggested posts, two per brand', () => {
    const picked = pickSuggestions([
      row('big', { views: 5000, engagements: 40 }),
      row('queued', { views: 9000, engagements: 90 }),
      row('done', { views: 9000, engagements: 90 }),
      row('tiny', { views: 12, engagements: 1 }),
      row('second', { views: 800, engagements: 5 }),
      row('third', { views: 700, engagements: 30 }),
      row('notyet', { views: 5000, engagements: 40, eligible: false, suggested: false }),
    ], new Set(['queued']), new Set(['done']));
    expect(picked.map((r) => r.id)).toEqual(['big', 'second']);
  });
});
