import { describe, expect, it } from 'vitest';
import { postDisplayTime, sortPostsByNewestDate } from '../post-ordering';

const at = (iso: string) => new Date(iso).getTime();

describe('postDisplayTime', () => {
  it('prefers publishedAt, then scheduledAt, then createdAt', () => {
    expect(postDisplayTime({
      publishedAt: '2026-08-05T10:00:00.000Z',
      scheduledAt: '2026-09-01T10:00:00.000Z',
      createdAt: '2026-01-01T10:00:00.000Z',
    })).toBe(at('2026-08-05T10:00:00.000Z'));

    expect(postDisplayTime({
      scheduledAt: '2026-09-01T10:00:00.000Z',
      createdAt: '2026-01-01T10:00:00.000Z',
    })).toBe(at('2026-09-01T10:00:00.000Z'));

    expect(postDisplayTime({ createdAt: '2026-01-01T10:00:00.000Z' }))
      .toBe(at('2026-01-01T10:00:00.000Z'));
  });

  it('treats a null scheduledAt as absent rather than as a date', () => {
    expect(postDisplayTime({ scheduledAt: null, createdAt: '2026-01-01T10:00:00.000Z' }))
      .toBe(at('2026-01-01T10:00:00.000Z'));
  });

  it('returns 0 for no date and for an unparseable one', () => {
    expect(postDisplayTime({})).toBe(0);
    expect(postDisplayTime({ scheduledAt: 'not a date' })).toBe(0);
  });
});

describe('sortPostsByNewestDate', () => {
  it('puts the newest date first regardless of which field carries it', () => {
    const posts = [
      { id: 'old-published', publishedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'future-scheduled', scheduledAt: '2026-09-10T00:00:00.000Z' },
      { id: 'recent-published', publishedAt: '2026-08-05T00:00:00.000Z' },
    ];
    expect(sortPostsByNewestDate(posts).map((p) => p.id))
      .toEqual(['future-scheduled', 'recent-published', 'old-published']);
  });

  it('sorts undated posts last instead of first', () => {
    const posts = [
      { id: 'undated' },
      { id: 'dated', scheduledAt: '2026-08-05T00:00:00.000Z' },
    ];
    expect(sortPostsByNewestDate(posts).map((p) => p.id)).toEqual(['dated', 'undated']);
  });

  it('does not mutate the input', () => {
    const posts = [
      { id: 'a', scheduledAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', scheduledAt: '2026-09-01T00:00:00.000Z' },
    ];
    const sorted = sortPostsByNewestDate(posts);
    expect(posts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
