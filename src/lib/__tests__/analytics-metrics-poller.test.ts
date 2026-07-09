import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const updateConnectionStatusMock = vi.fn();

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
  const metricsCollection = {
    doc: vi.fn(() => ({ set: snapshotSet })),
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
