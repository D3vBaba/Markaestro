import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const setConnectionStatusMock = vi.fn();
const recordActivityMock = vi.fn<(input: unknown) => Promise<number>>(async () => 1);
const upsertMarkaestroSocialPostMock = vi.fn();
const persistRawPlatformMetricsMock = vi.fn(async () => undefined);

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: collectionMock } }));
vi.mock('@/lib/platform/registry', () => ({ getAdapterForChannel: getAdapterForChannelMock }));
vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  setConnectionStatus: setConnectionStatusMock,
}));
vi.mock('@/lib/oauth/token-refresh', () => ({
  refreshConnectionToken: vi.fn(async () => null),
  refreshableProvider: () => null,
}));
vi.mock('@/lib/analytics/activity', () => ({ recordActivity: (input: unknown) => recordActivityMock(input) }));
vi.mock('@/lib/intelligence/raw-platform-metrics', () => ({ persistRawPlatformMetrics: persistRawPlatformMetricsMock }));
vi.mock('@/lib/intelligence/canonical-social-posts', () => ({
  canonicalSocialPostId: (channel: string, key: string, externalId: string) => `${channel}:${key}:${externalId}`,
  upsertMarkaestroSocialPost: upsertMarkaestroSocialPostMock,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

function makeMetrics(overrides: Record<string, number | null> = {}) {
  return {
    impressions: null, views: null, reach: null, likes: null, comments: null, shares: null, saves: null,
    clicks: null, profileVisits: null, followersGained: null, watchTimeSeconds: null,
    averageWatchTimeSeconds: null, completionRate: null, conversions: null, videoViews: null, raw: {},
    ...overrides,
  };
}

function makeQuery(docs: unknown[]) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn().mockResolvedValue({ size: docs.length, empty: docs.length === 0, docs }),
  };
  return query;
}

function makeNativeDoc(id: string, data: Record<string, unknown>) {
  const snapshotSet = vi.fn().mockResolvedValue(undefined);
  const snapshotUpdate = vi.fn().mockResolvedValue(undefined);
  const snapshotDoc = vi.fn(() => ({ set: snapshotSet, update: snapshotUpdate }));
  const ref = {
    update: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn(() => ({ doc: snapshotDoc })),
  };
  return { doc: { id, ref, data: () => data }, ref, snapshotSet, snapshotDoc };
}

const NOW = '2026-09-06T12:00:00.000Z';
const PUBLISHED = '2026-09-04T12:00:00.000Z'; // 48h before NOW

function nativePost(overrides: Record<string, unknown> = {}) {
  return {
    provenance: 'platform_native',
    platform: 'facebook',
    provider: 'meta',
    accountKey: 'page_1',
    externalId: 'fb_9',
    productId: 'prod_1',
    content: 'posted on the Page directly',
    publishedAt: PUBLISHED,
    metricsStatus: 'active',
    metricsPollStage: -1,
    metricsNextPollAt: NOW,
    metricsAttempts: 0,
    ...overrides,
  };
}

describe('pollDueNativePosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionForChannelMock.mockResolvedValue({ provider: 'meta', productId: 'prod_1', accountKey: 'page_1', metadata: {} });
  });

  it('takes the discovered snapshot whatever the post age, then continues the regular schedule', async () => {
    const post = makeNativeDoc('native_1', nativePost());
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    const fetchMetrics = vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 400, likes: 12 }) }));
    getAdapterForChannelMock.mockReturnValue({ fetchMetrics });

    const { pollDueNativePosts } = await import('../analytics/native-metrics-poller');
    const summary = await pollDueNativePosts('ws_1', NOW);

    expect(summary).toEqual(expect.objectContaining({ due: 1, polled: 1, affectedDates: ['2026-09-04'], errors: [] }));
    // The account the post was discovered on is the one asked.
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_1', 'facebook', 'prod_1', 'meta', 'page_1');
    expect(fetchMetrics).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channel: 'facebook', externalId: 'fb_9', destinationId: 'page_1' }));
    expect(post.snapshotDoc).toHaveBeenCalledWith('discovered');
    expect(post.snapshotSet).toHaveBeenCalledWith(expect.objectContaining({
      stageKey: 'discovered',
      capturedAt: NOW,
      byChannel: { facebook: expect.objectContaining({ views: 400, likes: 12 }) },
      metrics: expect.objectContaining({ views: 400 }),
    }));
    // 48h after publish the next stage still ahead is 72h.
    expect(post.ref.update).toHaveBeenCalledWith(expect.objectContaining({
      metricsStatus: 'active',
      metricsPollStage: 3,
      metricsNextPollAt: '2026-09-07T12:00:00.000Z',
      metricsByChannel: { facebook: expect.objectContaining({ views: 400 }) },
      latestMetrics: expect.objectContaining({ views: 400 }),
      metricsAttempts: 0,
    }));
    expect(recordActivityMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws_1', productId: 'prod_1' }));
    // The polled document is the canonical one; it must keep its native provenance.
    expect(upsertMarkaestroSocialPostMock).not.toHaveBeenCalled();
  });

  it('marks the schedule complete after the last stage', async () => {
    const post = makeNativeDoc('native_old', nativePost({
      publishedAt: '2026-06-01T12:00:00.000Z',
      metricsPollStage: 8,
    }));
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    getAdapterForChannelMock.mockReturnValue({ fetchMetrics: vi.fn(async () => ({ ok: true, metrics: makeMetrics({ views: 5 }) })) });

    const { pollDueNativePosts } = await import('../analytics/native-metrics-poller');
    await pollDueNativePosts('ws_1', NOW);

    expect(post.snapshotDoc).toHaveBeenCalledWith('90d');
    const update = post.ref.update.mock.calls[0][0] as Record<string, unknown>;
    expect(update.metricsStatus).toBe('complete');
    expect(update).not.toHaveProperty('metricsPollStage');
  });

  it('unschedules a document the Markaestro poller took over, without a platform call', async () => {
    const post = makeNativeDoc('taken_over', nativePost({ provenance: 'markaestro', markaestroPostId: 'post_1' }));
    collectionMock.mockReturnValue(makeQuery([post.doc]));
    const fetchMetrics = vi.fn();
    getAdapterForChannelMock.mockReturnValue({ fetchMetrics });

    const { pollDueNativePosts } = await import('../analytics/native-metrics-poller');
    const summary = await pollDueNativePosts('ws_1', NOW);

    expect(summary.polled).toBe(0);
    expect(fetchMetrics).not.toHaveBeenCalled();
    expect(post.ref.update).toHaveBeenCalledTimes(1);
    expect(post.ref.update.mock.calls[0][0]).toHaveProperty('metricsNextPollAt');
    expect(post.snapshotSet).not.toHaveBeenCalled();
  });

  it('parks a post the platform no longer serves and backs off a transient failure', async () => {
    const gone = makeNativeDoc('gone', nativePost({ externalId: 'fb_gone' }));
    const flaky = makeNativeDoc('flaky', nativePost({ externalId: 'fb_flaky', metricsAttempts: 1 }));
    collectionMock.mockReturnValue(makeQuery([gone.doc, flaky.doc]));
    getAdapterForChannelMock.mockReturnValue({
      fetchMetrics: vi.fn(async (_connection: unknown, input: { externalId: string }) => (
        input.externalId === 'fb_gone'
          ? { ok: false, reason: 'not_found', error: 'deleted' }
          : { ok: false, reason: 'transient', error: 'rate limited' }
      )),
    });

    const { pollDueNativePosts } = await import('../analytics/native-metrics-poller');
    const summary = await pollDueNativePosts('ws_1', NOW);

    expect(gone.ref.update).toHaveBeenCalledWith(expect.objectContaining({ metricsStatus: 'unsupported', metricsLastError: 'deleted' }));
    expect(flaky.ref.update).toHaveBeenCalledWith(expect.objectContaining({
      metricsAttempts: 2,
      metricsLastError: 'rate limited',
      metricsNextPollAt: '2026-09-06T14:00:00.000Z',
    }));
    expect(summary.errors).toEqual([{ postId: 'flaky', error: 'rate limited' }]);
  });
});
