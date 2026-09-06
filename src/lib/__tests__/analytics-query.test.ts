import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: collectionMock,
  },
}));

type QueryCall = [string, ...unknown[]];

function makeQuery() {
  const calls: QueryCall[] = [];
  const query = {
    calls,
    where: vi.fn((...args: unknown[]) => {
      calls.push(['where', ...args]);
      return query;
    }),
    orderBy: vi.fn((...args: unknown[]) => {
      calls.push(['orderBy', ...args]);
      return query;
    }),
    limit: vi.fn((...args: unknown[]) => {
      calls.push(['limit', ...args]);
      return query;
    }),
    select: vi.fn((...args: unknown[]) => {
      calls.push(['select', ...args]);
      return query;
    }),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  return query;
}

describe('analytics queries', () => {
  const queries = new Map<string, ReturnType<typeof makeQuery>>();

  beforeEach(() => {
    vi.clearAllMocks();
    queries.clear();
    collectionMock.mockImplementation((path: string) => {
      const query = makeQuery();
      queries.set(path, query);
      return query;
    });
  });

  it('pushes product filters into Firestore before applying the analytics row limit', async () => {
    const { buildAnalyticsResponse } = await import('../analytics/query');

    await buildAnalyticsResponse({
      workspaceId: 'ws_123',
      days: 28,
      requestedDays: 28,
      maxDays: -1,
      tier: 'business',
      productId: 'prod_123',
    });

    const postsQuery = queries.get('workspaces/ws_123/posts');
    expect(postsQuery?.calls).toEqual(expect.arrayContaining([
      ['where', 'status', '==', 'published'],
      ['where', 'productId', '==', 'prod_123'],
      ['orderBy', 'publishedAt', 'desc'],
      ['limit', 501],
    ]));
    const productWhereIndex = postsQuery?.calls.findIndex((call) => call[0] === 'where' && call[1] === 'productId');
    const limitIndex = postsQuery?.calls.findIndex((call) => call[0] === 'limit');
    expect(productWhereIndex).toBeGreaterThan(-1);
    expect(limitIndex).toBeGreaterThan(productWhereIndex ?? -1);
  });

  it('pushes product filters into Firestore before applying the CSV export limit', async () => {
    const { fetchPostRowsForExport } = await import('../analytics/query');

    await fetchPostRowsForExport(
      'ws_123',
      '2026-01-01T00:00:00.000Z',
      undefined,
      'prod_123',
    );

    const postsQuery = queries.get('workspaces/ws_123/posts');
    expect(postsQuery?.calls).toEqual(expect.arrayContaining([
      ['where', 'status', '==', 'published'],
      ['where', 'productId', '==', 'prod_123'],
      ['orderBy', 'publishedAt', 'desc'],
      ['limit', 5000],
    ]));
  });
});

describe('analytics across both post sources', () => {
  const DAY = 24 * 3600_000;
  const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const metrics = (views: number, likes: number) => ({
    impressions: null, views, reach: views, likes, comments: 0, shares: 0, saves: 0, clicks: null,
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
    completionRate: null, conversions: null, videoViews: null, raw: {},
  });
  const markaestroPost = {
    id: 'post_mk',
    data: () => ({
      content: 'scheduled through Markaestro',
      channel: 'instagram',
      publishedChannels: ['instagram'],
      publishedAt: recent(2),
      productId: 'prod_1',
      publishResults: [{ channel: 'instagram', success: true, externalId: 'ig_shared' }],
      metricsByChannel: { instagram: metrics(100, 10) },
      metricsUpdatedAt: recent(1),
    }),
  };
  const nativeDocs = [
    {
      id: 'native_only',
      data: () => ({
        provenance: 'platform_native', platform: 'instagram', externalId: 'ig_native', productId: 'prod_1',
        content: 'posted from the phone', contentType: 'video', permalink: 'https://instagram.com/p/n',
        publishedAt: recent(3), metricsByChannel: { instagram: metrics(900, 90) }, metricsUpdatedAt: recent(1),
      }),
    },
    {
      // The Markaestro post, seen from the account side: must count once.
      id: 'native_dup',
      data: () => ({
        provenance: 'platform_native', platform: 'instagram', externalId: 'ig_shared', productId: 'prod_1',
        content: 'scheduled through Markaestro', contentType: 'image', permalink: 'https://instagram.com/p/s',
        publishedAt: recent(2), metricsByChannel: { instagram: metrics(100, 10) },
      }),
    },
  ];
  const queries = new Map<string, ReturnType<typeof makeQuery>>();

  beforeEach(() => {
    vi.clearAllMocks();
    queries.clear();
    collectionMock.mockImplementation((path: string) => {
      const query = makeQuery();
      if (path.endsWith('/posts')) query.get.mockResolvedValue({ docs: [markaestroPost] });
      if (path.endsWith('/socialPosts')) query.get.mockResolvedValue({ docs: nativeDocs });
      queries.set(path, query);
      return query;
    });
  });

  it('reads native posts alongside Markaestro posts and counts a post seen on both sides once', async () => {
    const { buildAnalyticsResponse } = await import('../analytics/query');
    const response = await buildAnalyticsResponse({ workspaceId: 'ws_1', days: 28, requestedDays: 28, maxDays: -1, tier: 'business' });

    expect(queries.get('workspaces/ws_1/socialPosts')?.calls).toEqual(expect.arrayContaining([
      ['where', 'provenance', '==', 'platform_native'],
      ['orderBy', 'publishedAt', 'desc'],
      ['limit', 501],
    ]));
    expect(response.coverage.bySource).toEqual({ markaestro: 1, native: 1 });
    expect(response.coverage.postsAnalyzed).toBe(2);
    const ids = response.leaderboard.map((row) => `${row.id}:${row.source}`);
    expect(ids).toEqual(['native_only:native', 'post_mk:markaestro']);
    expect(response.leaderboard[0]).toEqual(expect.objectContaining({ contentType: 'video', externalUrl: 'https://instagram.com/p/n', views: 900 }));
  });

  it('narrows to one source from rows, and never reads native posts for source=markaestro', async () => {
    const { buildAnalyticsResponse } = await import('../analytics/query');
    const nativeOnly = await buildAnalyticsResponse({ workspaceId: 'ws_1', days: 28, requestedDays: 28, maxDays: -1, tier: 'business', source: 'native' });
    expect(nativeOnly.coverage.bySource).toEqual({ markaestro: 0, native: 1 });
    expect(nativeOnly.leaderboard.map((row) => row.id)).toEqual(['native_only']);
    // Totals come from the rows when a source is chosen: the rollups hold both.
    expect(nativeOnly.totals.posts).toBe(1);
    expect(nativeOnly.totals.views).toBe(900);

    queries.clear();
    const markaestroOnly = await buildAnalyticsResponse({ workspaceId: 'ws_1', days: 28, requestedDays: 28, maxDays: -1, tier: 'business', source: 'markaestro' });
    expect(queries.has('workspaces/ws_1/socialPosts')).toBe(false);
    expect(markaestroOnly.coverage.bySource).toEqual({ markaestro: 1, native: 0 });
  });

  it('exports both sources newest first with the same dedupe', async () => {
    const { fetchPostRowsForExport } = await import('../analytics/query');
    const rows = await fetchPostRowsForExport('ws_1', recent(30));
    expect(rows.map((row) => [row.id, row.source])).toEqual([['post_mk', 'markaestro'], ['native_only', 'native']]);
  });

  it('falls back to Markaestro posts alone when the native read fails', async () => {
    collectionMock.mockImplementation((path: string) => {
      const query = makeQuery();
      if (path.endsWith('/posts')) query.get.mockResolvedValue({ docs: [markaestroPost] });
      if (path.endsWith('/socialPosts')) query.get.mockRejectedValue(new Error('FAILED_PRECONDITION: index building'));
      return query;
    });
    const { buildAnalyticsResponse } = await import('../analytics/query');
    const response = await buildAnalyticsResponse({ workspaceId: 'ws_1', days: 28, requestedDays: 28, maxDays: -1, tier: 'business' });
    expect(response.coverage.bySource).toEqual({ markaestro: 1, native: 0 });
  });
});
