import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));

import { buildPostHistory } from '@/lib/analytics/history';
import { activitySeries, breakdownFromAggregates, breakdownFromRows, resolveWindow } from '@/lib/analytics/query';
import { initialPollState } from '@/lib/analytics/metrics-poller';
import { METRIC_POLL_STAGES, type ChannelDayAggregate } from '@/lib/analytics/types';
import type { NormalizedPostMetrics } from '@/lib/platform/types';

function m(partial: Partial<NormalizedPostMetrics>): NormalizedPostMetrics {
  return {
    impressions: null, views: null, reach: null, likes: null, comments: null, shares: null, saves: null, clicks: null,
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
    completionRate: null, conversions: null, videoViews: null,
    ...partial,
  } as NormalizedPostMetrics;
}

describe('resolveWindow', () => {
  const today = '2026-09-02';

  it('uses the preset when no explicit range is given', () => {
    expect(resolveWindow({ days: 28, maxDays: -1, todayUtc: today })).toMatchObject({
      sinceDate: '2026-08-06', untilDate: today, days: 28, priorSinceDate: '2026-07-09', priorUntilDate: '2026-08-05', custom: false,
    });
  });

  it('honours an explicit range and derives the prior period of equal length', () => {
    const window = resolveWindow({ days: 28, since: '2026-08-01', until: '2026-08-10', maxDays: -1, todayUtc: today });
    expect(window).toMatchObject({ sinceDate: '2026-08-01', untilDate: '2026-08-10', days: 10, requestedDays: 10, custom: true });
    expect(window.priorSinceDate).toBe('2026-07-22');
    expect(window.priorUntilDate).toBe('2026-07-31');
  });

  it('clamps a long custom range to the plan window from the end date backwards', () => {
    const window = resolveWindow({ days: 28, since: '2026-01-01', until: '2026-08-31', maxDays: 7, todayUtc: today });
    expect(window).toMatchObject({ sinceDate: '2026-08-25', untilDate: '2026-08-31', days: 7, requestedDays: 243, custom: true });
  });

  it('never reports beyond today and ignores malformed or inverted ranges', () => {
    expect(resolveWindow({ days: 7, since: '2026-08-30', until: '2026-12-31', maxDays: -1, todayUtc: today }).untilDate).toBe(today);
    expect(resolveWindow({ days: 7, since: '2026-08-10', until: '2026-08-01', maxDays: -1, todayUtc: today }).custom).toBe(false);
    expect(resolveWindow({ days: 7, since: 'yesterday', until: '2026-08-01', maxDays: -1, todayUtc: today }).custom).toBe(false);
    expect(resolveWindow({ days: 0, maxDays: -1, todayUtc: today }).days).toBe(1);
  });
});

describe('activity series', () => {
  it('sums channels per day, respects the channel and product scope, and fills missing days with zeros', () => {
    const docs = [
      {
        date: '2026-09-01', updatedAt: '', channels: { instagram: { views: 10, engagements: 2 }, tiktok: { views: 5 } },
        byProduct: { prod_1: { channels: { instagram: { views: 4, engagements: 1 } } } },
      },
    ];
    const dates = ['2026-08-31', '2026-09-01'];
    expect(activitySeries(docs, dates)).toEqual([
      { date: '2026-08-31', views: 0, reach: 0, engagements: 0, posts: 0 },
      { date: '2026-09-01', views: 15, reach: 0, engagements: 2, posts: 0 },
    ]);
    expect(activitySeries(docs, dates, 'tiktok')[1]!.views).toBe(5);
    expect(activitySeries(docs, dates, undefined, 'prod_1')[1]).toMatchObject({ views: 4, engagements: 1 });
    expect(activitySeries(docs, dates, undefined, 'prod_missing')[1]!.views).toBe(0);
  });
});

describe('engagement breakdown', () => {
  const agg = (partial: Partial<ChannelDayAggregate>): ChannelDayAggregate => ({
    posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagements: 0,
    postsWithViews: 0, postsWithReach: 0, postsWithEngagements: 0, ...partial,
  });

  it('sums interactions only from channel days that reported engagement', () => {
    const docs = [{
      date: '2026-09-01', posts: 3, updatedAt: '',
      channels: {
        instagram: agg({ likes: 10, comments: 2, shares: 1, saves: 3, clicks: 7, postsWithEngagements: 2 }),
        linkedin: agg({ likes: 99, postsWithEngagements: 0 }),
      },
    }];
    expect(breakdownFromAggregates(docs)).toEqual({ likes: 10, comments: 2, shares: 1, saves: 3, clicks: 7 });
    expect(breakdownFromAggregates(docs, 'linkedin')).toEqual({ likes: null, comments: null, shares: null, saves: null, clicks: null });
  });

  it('keeps unreported metrics null when derived from rows', () => {
    const rows = [
      { likes: 5, comments: null, shares: 1, saves: null, clicks: null },
      { likes: 2, comments: null, shares: null, saves: 4, clicks: null },
    ] as never[];
    expect(breakdownFromRows(rows)).toEqual({ likes: 7, comments: null, shares: 1, saves: 4, clicks: null });
  });
});

describe('post history', () => {
  it('orders snapshots, totals channels, and reports growth between stages', () => {
    const stages = buildPostHistory({
      publishedAt: '2026-09-01T00:00:00.000Z',
      snapshots: [
        { stageKey: '24h', capturedAt: '2026-09-02T00:05:00.000Z', byChannel: { instagram: m({ views: 300, likes: 20 }), facebook: m({ views: 50, likes: 2 }) } },
        { stageKey: '1h', capturedAt: '2026-09-01T01:00:00.000Z', byChannel: { instagram: m({ views: 100, likes: 5 }) } },
        { stageKey: 'bad', capturedAt: 'not a date', byChannel: {} },
      ],
      latest: { capturedAt: '2026-09-05T00:00:00.000Z', byChannel: { instagram: m({ views: 320, likes: 21 }), facebook: m({ views: 60, likes: 2 }) } },
    });
    expect(stages.map((s) => s.stageKey)).toEqual(['1h', '24h', 'latest']);
    expect(stages[0]).toMatchObject({ hoursAfterPublish: 1, views: 100, engagements: 5, viewsDelta: null, engagementsDelta: null });
    expect(stages[1]).toMatchObject({ hoursAfterPublish: 24, views: 350, engagements: 22, viewsDelta: 250, engagementsDelta: 17 });
    expect(stages[2]).toMatchObject({ views: 380, viewsDelta: 30, engagementsDelta: 1 });
  });

  it('does not append the latest metrics when they are older than the last snapshot', () => {
    const stages = buildPostHistory({
      publishedAt: null,
      snapshots: [{ stageKey: '6h', capturedAt: '2026-09-01T06:00:00.000Z', byChannel: { threads: m({ views: 10 }) } }],
      latest: { capturedAt: '2026-09-01T01:00:00.000Z', byChannel: { threads: m({ views: 5 }) } },
    });
    expect(stages).toHaveLength(1);
    expect(stages[0]!.hoursAfterPublish).toBeNull();
  });
});

describe('poll schedule long tail', () => {
  it('keeps polling evergreen posts at 60 and 90 days', () => {
    expect(METRIC_POLL_STAGES.map((s) => s.key)).toEqual(['1h', '6h', '24h', '72h', '7d', '14d', '30d', '60d', '90d']);
    const published = Date.parse('2026-06-01T00:00:00.000Z');
    const at45Days = published + 45 * 86_400_000;
    expect(initialPollState('2026-06-01T00:00:00.000Z', at45Days)).toEqual({ stage: 7, nextAt: '2026-07-31T00:00:00.000Z' });
    const at100Days = published + 100 * 86_400_000;
    expect(initialPollState('2026-06-01T00:00:00.000Z', at100Days).stage).toBe(8);
  });
});
