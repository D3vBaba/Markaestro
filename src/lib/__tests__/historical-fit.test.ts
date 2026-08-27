import { describe, expect, it } from 'vitest';
import {
  historicalFitAssessment,
  hourBucket,
  timingFitAssessment,
} from '@/lib/intelligence/historical-fit';

function post(views: number | null, publishedAt: string) {
  return { publishedAt, latestMetrics: { views } };
}

describe('historical and timing fit', () => {
  it('keeps history unavailable until five measured posts exist', () => {
    const posts = Array.from({ length: 4 }, (_, index) => post(10 + index, '2026-08-01T12:00:00Z'));
    expect(historicalFitAssessment(posts, 'awareness').score).toBeNull();
  });

  it('scores history from measured values without converting gaps to zero', () => {
    const posts = [
      post(100, '2026-08-01T12:00:00Z'),
      post(80, '2026-08-02T12:00:00Z'),
      post(null, '2026-08-03T12:00:00Z'),
      post(60, '2026-08-04T12:00:00Z'),
      post(40, '2026-08-05T12:00:00Z'),
      post(20, '2026-08-06T12:00:00Z'),
    ];
    const result = historicalFitAssessment(posts, 'awareness');
    expect(result.score).toBe(60);
    expect(result.evidence[0]).toContain('5 posts');
  });

  it('requires 20 posts and five observations in the cited hour before timing is account-specific', () => {
    const posts = Array.from({ length: 20 }, (_, index) => post(
      10,
      index < 4 ? '2026-08-25T15:00:00Z' : '2026-08-25T18:00:00Z',
    ));
    expect(timingFitAssessment({
      posts,
      timeZone: 'UTC',
      scheduledAt: '2026-08-25T15:00:00Z',
      objective: 'awareness',
    }).score).toBeNull();

    const enough = Array.from({ length: 20 }, (_, index) => post(
      index < 5 ? 20 : 10,
      index < 5 ? '2026-08-25T15:00:00Z' : '2026-08-25T18:00:00Z',
    ));
    const timed = timingFitAssessment({
      posts: enough,
      timeZone: 'UTC',
      scheduledAt: '2026-08-25T15:00:00Z',
      objective: 'awareness',
    });
    expect(hourBucket('2026-08-25T15:00:00Z', 'UTC')).toBe('Tue-15');
    expect(timed.score).not.toBeNull();
    expect(timed.evidence[0]).toContain('5 posts');
  });
});
