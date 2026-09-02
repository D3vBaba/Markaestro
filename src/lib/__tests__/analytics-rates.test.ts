import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));

import { postToRow, totalsFromAggregates } from '@/lib/analytics/query';
import type { ChannelDayAggregate, DailyAggregateDoc } from '@/lib/analytics/types';
import type { NormalizedPostMetrics } from '@/lib/platform/types';

function agg(partial: Partial<ChannelDayAggregate>): ChannelDayAggregate {
  return {
    posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagements: 0,
    postsWithViews: 0, postsWithReach: 0, postsWithEngagements: 0,
    ...partial,
  };
}

function metrics(partial: Partial<NormalizedPostMetrics>): NormalizedPostMetrics {
  return {
    impressions: null, views: null, reach: null, likes: null, comments: null, shares: null, saves: null, clicks: null,
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
    completionRate: null, conversions: null, videoViews: null,
    ...partial,
  } as NormalizedPostMetrics;
}

describe('engagement rates across channels', () => {
  const day: DailyAggregateDoc = {
    date: '2026-08-01',
    posts: 3,
    updatedAt: '2026-08-02T00:00:00.000Z',
    channels: {
      // Instagram reports reach and views.
      instagram: agg({ posts: 2, views: 1000, reach: 800, engagements: 80, postsWithViews: 2, postsWithReach: 2, postsWithEngagements: 2 }),
      // TikTok reports views but never reach.
      tiktok: agg({ posts: 1, views: 5000, reach: 0, engagements: 250, postsWithViews: 1, postsWithReach: 0, postsWithEngagements: 1 }),
    },
  };

  it('keeps TikTok engagements out of the reach rate and in the views rate', () => {
    const totals = totalsFromAggregates([day]);
    expect(totals.engagements).toBe(330);
    expect(totals.reach).toBe(800);
    // 80 / 800, not 330 / 800.
    expect(totals.engagementRateByReach).toBeCloseTo(0.1, 5);
    // 330 / 6000 across both channels.
    expect(totals.engagementRateByViews).toBeCloseTo(0.055, 5);
  });

  it('reports only the views rate for a channel with no reach at all', () => {
    const totals = totalsFromAggregates([day], 'tiktok');
    expect(totals.engagementRateByReach).toBeNull();
    expect(totals.engagementRateByViews).toBeCloseTo(0.05, 5);
    expect(totals.reach).toBeNull();
  });

  it('gives a post row both rates, null when the denominator is missing', () => {
    const row = postToRow('p1', {
      channel: 'threads',
      publishedAt: '2026-08-01T10:00:00.000Z',
      mediaUrls: [],
      metricsByChannel: { threads: metrics({ views: 400, likes: 10, comments: 2 }) },
    } as never);
    expect(row.engagements).toBe(12);
    expect(row.erByReach).toBeNull();
    expect(row.erByViews).toBeCloseTo(0.03, 5);
    expect(row.contentType).toBe('text');
  });
});
