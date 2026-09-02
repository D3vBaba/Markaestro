import { beforeEach, describe, expect, it, vi } from 'vitest';

const setMock = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: (path: string) => ({ path, set: (data: unknown, options: unknown) => setMock(path, data, options) }) },
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }), delete: () => ({ __delete: true }) },
}));

import { activityDeltasByChannel, activityFromSnapshots, activityIncrements, metricsDelta, recordActivity } from '@/lib/analytics/activity';
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

describe('activityFromSnapshots', () => {
  it('rebuilds growth per observation day from a post history and skips snapshots the live path booked', () => {
    const perDate = activityFromSnapshots([
      { capturedAt: '2026-08-02T00:00:00.000Z', byChannel: { instagram: m({ views: 300, likes: 20 }) } },
      { capturedAt: '2026-08-01T01:00:00.000Z', byChannel: { instagram: m({ views: 100, likes: 5 }) } },
      { capturedAt: '2026-08-08T00:00:00.000Z', byChannel: { instagram: m({ views: 320, likes: 21 }) }, activityBooked: true },
      { capturedAt: '2026-08-15T00:00:00.000Z', byChannel: { instagram: m({ views: 330, likes: 21 }) } },
      { capturedAt: 'garbage', byChannel: { instagram: m({ views: 999 }) } },
    ], 'prod_1');
    expect([...perDate.keys()]).toEqual(['2026-08-01', '2026-08-02', '2026-08-15']);
    expect(perDate.get('2026-08-01')).toMatchObject({ 'channels.instagram.views': 100, 'channels.instagram.likes': 5, 'byProduct.prod_1.channels.instagram.engagements': 5 });
    expect(perDate.get('2026-08-02')).toMatchObject({ 'channels.instagram.views': 200, 'channels.instagram.likes': 15 });
    // The booked snapshot still anchors the next delta even though it is not re-booked.
    expect(perDate.get('2026-08-15')).toMatchObject({ 'channels.instagram.views': 10 });
    expect(perDate.get('2026-08-15')).not.toHaveProperty('channels.instagram.likes');
  });

  it('merges several snapshots captured on the same day', () => {
    const perDate = activityFromSnapshots([
      { capturedAt: '2026-08-01T01:00:00.000Z', byChannel: { threads: m({ views: 10 }) } },
      { capturedAt: '2026-08-01T06:00:00.000Z', byChannel: { threads: m({ views: 25 }) } },
    ], null);
    expect(perDate.get('2026-08-01')).toEqual({ 'channels.threads.views': 25 });
  });
});

describe('backfillActivityPage', () => {
  it('books unmarked posts in one atomic batch, marks them, skips done and sandbox posts, and reports the cursor', async () => {
    const { adminDb } = await import('@/lib/firebase-admin');
    const batchOps: Array<[string, unknown, unknown?]> = [];
    const batch = {
      set: (ref: { path: string }, data: unknown, options: unknown) => batchOps.push(['set:' + ref.path, data, options]),
      update: (ref: { path: string }, data: unknown) => batchOps.push(['update:' + ref.path, data]),
      commit: vi.fn(async () => undefined),
    };
    (adminDb as unknown as { batch: () => typeof batch }).batch = () => batch;
    const history = (rows: Array<Record<string, unknown>>) => ({
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: rows.map((row) => ({ data: () => row })) }) }) }),
    });
    const posts = [
      { id: 'a', data: { publishedAt: '2026-08-10T00:00:00.000Z', productId: 'p1' }, history: [
        { capturedAt: '2026-08-10T01:00:00.000Z', byChannel: { instagram: m({ views: 50 }) } },
        { capturedAt: '2026-08-11T01:00:00.000Z', byChannel: { instagram: m({ views: 80 }) } },
      ] },
      { id: 'b', data: { publishedAt: '2026-08-09T00:00:00.000Z', activityBackfilledAt: '2026-09-01T00:00:00.000Z' }, history: [
        { capturedAt: '2026-08-09T01:00:00.000Z', byChannel: { instagram: m({ views: 999 }) } },
      ] },
      { id: 'c', data: { publishedAt: '2026-08-08T00:00:00.000Z', testMode: true }, history: [
        { capturedAt: '2026-08-08T01:00:00.000Z', byChannel: { instagram: m({ views: 999 }) } },
      ] },
      { id: 'd', data: { publishedAt: '2026-08-07T00:00:00.000Z' }, history: [
        { capturedAt: '2026-08-11T02:00:00.000Z', byChannel: { threads: m({ views: 7 }) } },
      ] },
    ];
    const docs = posts.map((post) => ({
      ref: { path: `workspaces/ws/posts/${post.id}`, collection: () => history(post.history) },
      data: () => post.data,
    }));
    const startAfter = vi.fn();
    const query = {
      where: () => query,
      orderBy: () => query,
      startAfter: (...args: unknown[]) => { startAfter(...args); return query; },
      limit: () => query,
      get: async () => ({ size: docs.length, empty: false, docs }),
    };
    (adminDb as unknown as { collection: () => typeof query }).collection = () => query;
    (adminDb as unknown as { doc: (path: string) => { path: string } }).doc = (path: string) => ({ path });

    const { backfillActivityPage } = await import('@/lib/analytics/activity');
    const page = await backfillActivityPage('ws', '2026-09-02T00:00:00.000Z', { afterPublishedAt: '2026-08-20T00:00:00.000Z', limit: 100 });

    expect(startAfter).toHaveBeenCalledWith('2026-08-20T00:00:00.000Z');
    expect(page).toEqual({ posts: 4, booked: 2, days: 2, done: true, cursor: '2026-08-07T00:00:00.000Z' });
    expect(batch.commit).toHaveBeenCalledTimes(1);
    const sets = Object.fromEntries(batchOps.filter(([op]) => op.startsWith('set:')).map(([op, data]) => [op, data]));
    expect(sets['set:workspaces/ws/analyticsActivity/2026-08-10']).toMatchObject({ 'channels.instagram.views': { __increment: 50 }, 'byProduct.p1.channels.instagram.views': { __increment: 50 } });
    expect(sets['set:workspaces/ws/analyticsActivity/2026-08-11']).toMatchObject({ 'channels.instagram.views': { __increment: 30 }, 'channels.threads.views': { __increment: 7 } });
    const marked = batchOps.filter(([op]) => op.startsWith('update:')).map(([op]) => op);
    expect(marked).toEqual(['update:workspaces/ws/posts/a', 'update:workspaces/ws/posts/d']);
  });
});
