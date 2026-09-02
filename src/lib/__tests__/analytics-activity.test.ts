import { beforeEach, describe, expect, it, vi } from 'vitest';

const setMock = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: (path: string) => ({ path, set: (data: unknown, options: unknown) => setMock(path, data, options) }) },
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }), delete: () => ({ __delete: true }) },
}));

import { activityDeltasByChannel, activityIncrements, metricsDelta, recordActivity } from '@/lib/analytics/activity';
import type { NormalizedPostMetrics } from '@/lib/platform/types';

function m(partial: Partial<NormalizedPostMetrics>): NormalizedPostMetrics {
  return {
    impressions: null, views: null, reach: null, likes: null, comments: null, shares: null, saves: null, clicks: null,
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
    completionRate: null, conversions: null, videoViews: null,
    ...partial,
  } as NormalizedPostMetrics;
}

describe('metricsDelta', () => {
  it('counts a first observation in full and later ones as growth', () => {
    expect(metricsDelta(undefined, m({ views: 120, likes: 4 }))).toEqual({ views: 120, likes: 4, engagements: 4 });
    expect(metricsDelta(m({ views: 120, likes: 4 }), m({ views: 150, likes: 9, comments: 1 })))
      .toEqual({ views: 30, likes: 5, comments: 1, engagements: 6 });
  });

  it('never books negative activity and leaves unreported metrics absent', () => {
    const delta = metricsDelta(m({ views: 200, likes: 10 }), m({ views: 180, likes: 10 }));
    expect(delta).toEqual({ views: 0, likes: 0, engagements: 0 });
    expect(delta).not.toHaveProperty('reach');
  });

  it('treats a metric that appears later as new growth', () => {
    expect(metricsDelta(m({ views: 100 }), m({ views: 100, reach: 80 }))).toEqual({ views: 0, reach: 80 });
  });
});

describe('activity increments', () => {
  it('flattens per-channel growth into workspace and product paths, dropping zeros', () => {
    const deltas = activityDeltasByChannel(
      { instagram: m({ views: 100, likes: 5 }) },
      { instagram: m({ views: 130, likes: 5 }), tiktok: m({ views: 40 }) },
    );
    expect(activityIncrements(deltas, 'prod_1')).toEqual({
      'channels.instagram.views': 30,
      'byProduct.prod_1.channels.instagram.views': 30,
      'channels.tiktok.views': 40,
      'byProduct.prod_1.channels.tiktok.views': 40,
    });
    expect(activityIncrements(deltas, null)).not.toHaveProperty('byProduct.prod_1.channels.tiktok.views');
  });
});

describe('recordActivity', () => {
  beforeEach(() => setMock.mockClear());

  it('writes one merged document of atomic increments under the observation day', async () => {
    const written = await recordActivity({
      workspaceId: 'ws',
      date: '2026-09-02',
      productId: 'prod_1',
      previous: { threads: m({ views: 10, likes: 1 }) },
      next: { threads: m({ views: 25, likes: 3 }) },
      nowIso: '2026-09-02T10:00:00.000Z',
    });
    expect(written).toBe(6);
    expect(setMock).toHaveBeenCalledTimes(1);
    const [path, data, options] = setMock.mock.calls[0]!;
    expect(path).toBe('workspaces/ws/analyticsActivity/2026-09-02');
    expect(options).toEqual({ merge: true });
    expect(data).toMatchObject({
      date: '2026-09-02',
      'channels.threads.views': { __increment: 15 },
      'channels.threads.engagements': { __increment: 2 },
      'byProduct.prod_1.channels.threads.likes': { __increment: 2 },
    });
  });

  it('writes nothing when nothing grew', async () => {
    const written = await recordActivity({
      workspaceId: 'ws', date: '2026-09-02', productId: null,
      previous: { threads: m({ views: 10 }) }, next: { threads: m({ views: 10 }) },
      nowIso: '2026-09-02T10:00:00.000Z',
    });
    expect(written).toBe(0);
    expect(setMock).not.toHaveBeenCalled();
  });
});
