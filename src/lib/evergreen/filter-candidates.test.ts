import { describe, expect, it } from 'vitest';
import { rankEvergreenCandidates } from './candidates';
import { candidateMetric, filterEvergreenCandidates } from './filter-candidates';

const candidates = rankEvergreenCandidates([
  { id: 'small', content: 'Small guide', channel: 'instagram', metrics: { views: 9, saves: 20 } },
  { id: 'large', content: 'Popular guide', channel: 'instagram', metrics: { views: 3608, saves: 2 } },
  { id: 'zero', channel: 'instagram', metrics: { views: 0 } },
  { id: 'unknown', channel: 'instagram', metrics: { likes: 100 } },
  { id: 'unavailable', channel: 'instagram', metrics: { views: 99999, availability: { views: { state: 'unavailable' } } } },
  { id: 'other', channel: 'facebook', metrics: { views: 99999 } },
  { id: 'shared', channel: 'instagram', targetChannels: ['instagram', 'facebook'], metricsByChannel: { instagram: { views: 10 }, facebook: { views: 99999 } } },
  { id: 'unattributed', channel: 'instagram', targetChannels: ['instagram', 'facebook'], metrics: { views: 99999 } },
].map((post) => ({ status: 'published', publishedAt: '2026-08-01', ...post })));

describe('Evergreen performance browsing', () => {
  it('ranks the selected platform only, excludes missing measurements and retains measured zero', () => {
    const rows = filterEvergreenCandidates(candidates, { channel: 'instagram', metric: 'views', query: '' });
    expect(rows.map((row) => row.id)).toEqual(['large', 'shared', 'small', 'zero']);
    expect(candidateMetric(rows[1], 'instagram', 'views')).toBe(10);
    expect(rows.every((row) => !row.suggested && row.assessment.recommendation === 'not_evaluated')).toBe(true);
  });

  it('lets the chosen objective change which post comes first', () => {
    expect(filterEvergreenCandidates(candidates, { channel: 'instagram', metric: 'saves', query: '' }).map((row) => row.id)).toEqual(['small', 'large']);
  });

  it('combines search and performance filtering without modifying the original library', () => {
    const original = candidates.map((row) => row.id);
    expect(filterEvergreenCandidates(candidates, { channel: 'instagram', metric: 'views', query: '  POPULAR guide  ' }).map((row) => row.id)).toEqual(['large']);
    expect(candidates.map((row) => row.id)).toEqual(original);
    expect(filterEvergreenCandidates(candidates, { channel: 'instagram', metric: 'clicks', query: '' })).toEqual([]);
  });

  it('does not rank unrelated platforms together when a channel is absent', () => {
    expect(filterEvergreenCandidates(candidates, { channel: '', metric: 'views', query: '' })).toEqual([]);
  });

  it('restores unmeasured posts in the recent view and sorts ties consistently', () => {
    const rows = filterEvergreenCandidates(candidates, { channel: '', metric: null, query: '' });
    expect(rows.map((row) => row.id)).toEqual(candidates.map((row) => row.id).sort());
    const newest = { ...candidates[0], id: 'newest', publishedAt: '2026-09-01' };
    expect(filterEvergreenCandidates([...candidates, newest], { channel: '', metric: null, query: '' })[0].id).toBe('newest');
    expect(filterEvergreenCandidates(candidates, { channel: 'facebook', metric: null, query: '' }).map((row) => row.id)).toEqual(['other', 'shared', 'unattributed']);
  });
});
