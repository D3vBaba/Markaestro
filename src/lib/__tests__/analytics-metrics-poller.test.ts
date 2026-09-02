import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const updateConnectionStatusMock = vi.fn();
const recordActivityMock = vi.fn<(input: unknown) => Promise<number>>(async () => 1);
vi.mock('@/lib/analytics/activity', () => ({ recordActivity: (input: unknown) => recordActivityMock(input) }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: collectionMock,
  },
}));

vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  updateConnectionStatus: updateConnectionStatusMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeMetrics(overrides: Record<string, number | null> = {}) {
  return {
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    videoViews: null,
    raw: {},
    ...overrides,
  };
}

function makeQuery(docs: unknown[]) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn().mockResolvedValue({
      size: docs.length,
      empty: docs.length === 0,
      docs,
    }),
  };
  return query;
}

function makePostDoc(data: Record<string, unknown>) {
  const snapshotSet = vi.fn().mockResolvedValue(undefined);
  const snapshotUpdate = vi.fn().mockResolvedValue(undefined);
  const metricsCollection = {
    doc: vi.fn(() => ({ set: snapshotSet, update: snapshotUpdate })),
  };
  const ref = {
    update: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn(() => metricsCollection),
  };
  return {
    doc: {
      id: 'post_123',
      ref,
      data: () => data,
    },
    ref,
    snapshotSet,
    snapshotUpdate,
  };
}

describe('pollDueMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionForChannelMock.mockResolvedValue({
      provider: 'meta',
      productId: 'prod_123',
    });
  });

  it('keeps the same poll stage retryable when one channel succeeds and another has a transient error', async () => {
    const post = makePostDoc({
      productId: 'prod_123',
      publishedAt: '2026-01-01T00:00:00.000Z',
      metricsPollStage: 0,
      metricsAttempts: 0,
      publishResults: [
        { channel: 'facebook', success: true, externalId: 'fb_1' },
        { channel: 'instagram', success: true, externalId: 'ig_1' },
      ],
    });
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    getAdapterForChannelMock.mockReturnValue({
      fetchMetrics: vi.fn(async (_connection, input: { channel: string }) => (
        input.channel === 'facebook'
          ? { ok: true, metrics: makeMetrics({ views: 100, likes: 3 }) }
          : { ok: false, reason: 'transient', error: 'rate limited' }
      )),
    });

    const { pollDueMetrics } = await import('../analytics/metrics-poller');
    const summary = await pollDueMetrics('ws_123', '2026-01-01T01:00:00.000Z');

    expect(summary.polled).toBe(1);
    expect(summary.errors).toEqual([{ postId: 'post_123', error: 'rate limited' }]);
    expect(post.snapshotSet).toHaveBeenCalledWith(expect.objectContaining({
      stageKey: '1h',
      byChannel: {
        facebook: expect.objectContaining({ views: 100, likes: 3 }),
      },
    }));
    expect(post.ref.update).toHaveBeenCalledWith(expect.objectContaining({
      metricsStatus: 'active',
      metricsPollStage: 0,
      metricsAttempts: 1,
      metricsNextPollAt: '2026-01-01T02:00:00.000Z',
      metricsLastError: 'rate limited',
    }));
  });

  it('advances mixed-result polls after the retry budget instead of parking good channel data', async () => {
    const post = makePostDoc({
      productId: 'prod_123',
      publishedAt: '2026-01-01T00:00:00.000Z',
      metricsPollStage: 0,
      metricsAttempts: 9,
      publishResults: [
        { channel: 'facebook', success: true, externalId: 'fb_1' },
        { channel: 'instagram', success: true, externalId: 'ig_1' },
      ],
    });
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    getAdapterForChannelMock.mockReturnValue({
      fetchMetrics: vi.fn(async (_connection, input: { channel: string }) => (
        input.channel === 'facebook'
          ? { ok: true, metrics: makeMetrics({ views: 100 }) }
          : { ok: false, reason: 'transient', error: 'rate limited' }
      )),
    });

    const { pollDueMetrics } = await import('../analytics/metrics-poller');
    const summary = await pollDueMetrics('ws_123', '2026-01-01T01:00:00.000Z');

    expect(summary.polled).toBe(1);
    expect(summary.errors).toEqual([{ postId: 'post_123', error: 'rate limited' }]);
    expect(post.ref.update).toHaveBeenCalledWith(expect.objectContaining({
      metricsStatus: 'active',
      metricsPollStage: 1,
      metricsAttempts: 0,
      metricsNextPollAt: '2026-01-01T06:00:00.000Z',
      metricsLastError: 'rate limited',
    }));
  });
});

describe('refreshPostsNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionForChannelMock.mockResolvedValue({
      provider: 'meta',
      productId: 'prod_123',
    });
  });

  it('refreshes denormalized metrics + snapshot without advancing the poll schedule', async () => {
    const post = makePostDoc({
      productId: 'prod_123',
      publishedAt: '2026-03-10T00:00:00.000Z',
      metricsPollStage: 2, // -> stageKey '24h'
      metricsStatus: 'complete',
      metricsNextPollAt: '2026-03-20T00:00:00.000Z',
      publishResults: [{ channel: 'facebook', success: true, externalId: 'fb_1' }],
    });
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    getAdapterForChannelMock.mockReturnValue({
      fetchMetrics: vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 250 }) })),
    });

    const { refreshPostsNow } = await import('../analytics/metrics-poller');
    const summary = await refreshPostsNow('ws_123', '2026-03-15T12:00:00.000Z', {
      productId: 'prod_123',
    });

    expect(summary.polled).toBe(1);
    expect(summary.affectedDates).toEqual(['2026-03-10']);
    expect(post.snapshotSet).toHaveBeenCalledWith(expect.objectContaining({
      stageKey: '24h',
      capturedAt: '2026-03-15T12:00:00.000Z',
      byChannel: { facebook: expect.objectContaining({ views: 250 }) },
    }));

    // The denormalized latest-metrics fields update...
    const updateArg = post.ref.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({
      metricsByChannel: { facebook: expect.objectContaining({ views: 250 }) },
      metricsUpdatedAt: '2026-03-15T12:00:00.000Z',
    });
    // ...but the decaying schedule is deliberately left untouched.
    expect(updateArg).not.toHaveProperty('metricsPollStage');
    expect(updateArg).not.toHaveProperty('metricsNextPollAt');
    expect(updateArg).not.toHaveProperty('metricsStatus');
  });

  it('stops taking new posts once the deadline passes and reports the remainder', async () => {
    const posts = ['a', 'b', 'c'].map((id) => {
      const post = makePostDoc({
        status: 'published',
        channel: 'facebook',
        publishedAt: '2026-03-10T00:00:00.000Z',
        publishResults: [{ channel: 'facebook', success: true, externalId: `fb_${id}` }],
      });
      post.doc.id = `post_${id}`;
      return post;
    });
    collectionMock.mockReturnValue(makeQuery(posts.map((post) => post.doc)));
    const fetchMetrics = vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 1 }) }));
    getAdapterForChannelMock.mockReturnValue({ fetchMetrics });

    const { refreshPostsNow } = await import('../analytics/metrics-poller');
    const summary = await refreshPostsNow('ws_123', '2026-03-15T12:00:00.000Z', {
      deadlineMs: Date.now() - 1,
    });

    expect(summary.due).toBe(3);
    expect(summary.polled).toBe(0);
    expect(summary.remaining).toBe(3);
    expect(fetchMetrics).not.toHaveBeenCalled();
  });

  it('books metric growth under the observation day when a refresh lands new numbers', async () => {
    recordActivityMock.mockClear();
    const post = makePostDoc({
      status: 'published',
      channel: 'facebook',
      productId: 'prod_123',
      publishedAt: '2026-03-10T00:00:00.000Z',
      metricsByChannel: { facebook: makeMetrics({ views: 100 }) },
      publishResults: [{ channel: 'facebook', success: true, externalId: 'fb_1' }],
    });
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    getAdapterForChannelMock.mockReturnValue({
      fetchMetrics: vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 250 }) })),
    });
    const { refreshPostsNow } = await import('../analytics/metrics-poller');
    await refreshPostsNow('ws_123', '2026-03-15T12:00:00.000Z');
    expect(recordActivityMock).toHaveBeenCalledTimes(1);
    // The snapshot is stamped so the one-time rebuild never books it again.
    expect(post.snapshotUpdate).toHaveBeenCalledWith({ activityBooked: true });
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_123',
      date: '2026-03-15',
      productId: 'prod_123',
      previous: { facebook: expect.objectContaining({ views: 100 }) },
      next: { facebook: expect.objectContaining({ views: 250 }) },
    }));
  });

  it('only fetches the requested channel when a channel filter is supplied', async () => {
    const post = makePostDoc({
      productId: 'prod_123',
      publishedAt: '2026-03-10T00:00:00.000Z',
      metricsPollStage: 0,
      publishResults: [
        { channel: 'facebook', success: true, externalId: 'fb_1' },
        { channel: 'instagram', success: true, externalId: 'ig_1' },
      ],
    });
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    const fetchMetrics = vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 5 }) }));
    getAdapterForChannelMock.mockReturnValue({ fetchMetrics });

    const { refreshPostsNow } = await import('../analytics/metrics-poller');
    const summary = await refreshPostsNow('ws_123', '2026-03-15T12:00:00.000Z', {
      channel: 'instagram',
    });

    expect(summary.channelFetches).toBe(1);
    expect(fetchMetrics).toHaveBeenCalledTimes(1);
    expect(fetchMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'instagram', externalId: 'ig_1' }),
    );
  });
});
