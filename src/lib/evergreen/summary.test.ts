import { describe, expect, it } from 'vitest';
import { summarizeEvergreenEarned } from './summary';

const now = new Date('2026-09-04T00:00:00Z');
const m = (views: number, likes: number) => ({ instagram: { views, likes } });

describe('summarizeEvergreenEarned', () => {
  it('compares evergreen occurrences to fresh posts per post inside the window', () => {
    const summary = summarizeEvergreenEarned({
      days: 30,
      now,
      occurrences: [
        { id: 'o1', status: 'published', publishedAt: '2026-08-20T00:00:00Z', metricsByChannel: m(400, 20) },
        { id: 'o2', status: 'published', publishedAt: '2026-08-25T00:00:00Z', metricsByChannel: m(200, 10) },
        { id: 'old', status: 'published', publishedAt: '2026-06-01T00:00:00Z', metricsByChannel: m(9000, 900) },
      ],
      freshPosts: [
        { id: 'f1', status: 'published', publishedAt: '2026-08-22T00:00:00Z', metricsByChannel: m(100, 5) },
        { id: 'f2', status: 'published', publishedAt: '2026-08-23T00:00:00Z', metricsByChannel: m(100, 5) },
        { id: 'o1', status: 'published', publishedAt: '2026-08-20T00:00:00Z', sourceType: 'evergreen', metricsByChannel: m(400, 20) },
      ],
      attribution: new Map([['o1', { clicks: 7, conversions: 1 }]]),
    });
    expect(summary.occurrences).toBe(2);
    expect(summary.freshPosts).toBe(2);
    expect(summary.evergreen).toMatchObject({ views: 600, engagements: 30, trackedLinkClicks: 7, attributedConversions: 1 });
    expect(summary.perPost).toEqual({ evergreen: { views: 300, engagements: 15 }, fresh: { views: 100, engagements: 5 } });
  });
});
