import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
const postGetMock = vi.fn();
const snapshotsGetMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: () => ({
      get: postGetMock,
      collection: () => ({ orderBy: () => ({ limit: () => ({ get: snapshotsGetMock }) }) }),
    }),
  },
}));

const POST_ID = 'post_1';

function call(id: string) {
  return import('./route').then(({ GET }) => GET(
    new Request(`http://localhost/api/public/v1/analytics/posts/${id}/history`),
    { params: Promise.resolve({ id }) },
  ));
}

function metrics(views: number, likes: number) {
  return {
    impressions: null, views, reach: views * 2, likes, comments: 0, shares: 0, saves: 0, clicks: null,
    profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
    completionRate: null, conversions: null, videoViews: null, raw: {},
  };
}

function publishedPost(overrides: Record<string, unknown> = {}) {
  return {
    status: 'published',
    productId: 'prod_1',
    content: 'A caption',
    channel: 'instagram',
    publishedChannels: ['instagram'],
    publishedAt: '2026-08-01T10:00:00.000Z',
    externalUrl: 'https://instagram.com/p/1',
    mediaUrls: ['https://cdn/x.jpg'],
    metricsStatus: 'active',
    metricsNextPollAt: '2026-08-08T10:00:00.000Z',
    metricsUpdatedAt: '2026-08-04T10:00:00.000Z',
    metricsByChannel: { instagram: metrics(300, 30) },
    ...overrides,
  };
}

describe('GET /api/public/v1/analytics/posts/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockResolvedValue({
      principalType: 'api_client',
      workspaceId: 'ws_1',
      clientId: 'cli_1',
      productId: 'prod_1',
      planTier: 'pro',
      rateLimitHeaders: { 'X-RateLimit-Limit': '20' },
    });
    postGetMock.mockResolvedValue({ exists: true, data: () => publishedPost() });
    snapshotsGetMock.mockResolvedValue({
      docs: [
        { data: () => ({ postId: POST_ID, stageKey: '1h', capturedAt: '2026-08-01T11:00:00.000Z', publishedAt: '2026-08-01T10:00:00.000Z', byChannel: { instagram: metrics(100, 10) } }) },
        { data: () => ({ postId: POST_ID, stageKey: '24h', capturedAt: '2026-08-02T10:00:00.000Z', publishedAt: '2026-08-01T10:00:00.000Z', byChannel: { instagram: metrics(250, 20) } }) },
      ],
    });
  });

  it('returns the stages oldest first, the growth between them, and the current totals', async () => {
    const response = await call(POST_ID);

    expect(response.status).toBe(200);
    expect(requirePublicApiContextMock).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ scope: 'analytics.read' }));
    const body = await response.json();
    expect(body.post).toEqual(expect.objectContaining({
      id: POST_ID,
      content: 'A caption',
      channels: ['instagram'],
      metricsStatus: 'active',
      nextPollAt: '2026-08-08T10:00:00.000Z',
    }));
    expect(body.post.latest).toEqual(expect.objectContaining({ id: POST_ID, views: 300, likes: 30, contentType: 'image' }));
    expect(body.stages.map((stage: { stageKey: string }) => stage.stageKey)).toEqual(['1h', '24h', 'latest']);
    expect(body.stages[1]).toEqual(expect.objectContaining({ views: 250, viewsDelta: 150 }));
    expect(body.stages[0].viewsDelta).toBeNull();
    expect(response.headers.get('X-RateLimit-Limit')).toBe('20');
  });

  it('resolves a post published directly on the platform by its canonical id', async () => {
    const nativeDoc = {
      provenance: 'platform_native',
      platform: 'instagram',
      externalId: 'ig_9',
      productId: 'prod_1',
      content: 'posted from the phone',
      contentType: 'video',
      permalink: 'https://instagram.com/p/9',
      publishedAt: '2026-08-01T10:00:00.000Z',
      metricsStatus: 'active',
      metricsNextPollAt: '2026-08-08T10:00:00.000Z',
      metricsUpdatedAt: '2026-08-04T10:00:00.000Z',
      metricsByChannel: { instagram: metrics(300, 30) },
    };
    postGetMock
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({ exists: true, data: () => nativeDoc });
    snapshotsGetMock.mockResolvedValue({
      docs: [
        { data: () => ({ postId: 'native_9', stageKey: 'discovered', capturedAt: '2026-08-03T10:00:00.000Z', publishedAt: '2026-08-01T10:00:00.000Z', byChannel: { instagram: metrics(200, 20) } }) },
      ],
    });

    const response = await call('native_9');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.post).toEqual(expect.objectContaining({
      id: 'native_9',
      source: 'native',
      channels: ['instagram'],
      externalUrl: 'https://instagram.com/p/9',
      metricsStatus: 'active',
    }));
    expect(body.post.latest).toEqual(expect.objectContaining({ source: 'native', contentType: 'video', views: 300 }));
    expect(body.stages.map((stage: { stageKey: string }) => stage.stageKey)).toEqual(['discovered', 'latest']);
  });

  it('answers 404 for a native post in another brand', async () => {
    postGetMock
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({ exists: true, data: () => ({ provenance: 'platform_native', platform: 'instagram', externalId: 'ig_9', productId: 'prod_other', publishedAt: '2026-08-01T10:00:00.000Z' }) });

    expect((await call('native_9')).status).toBe(404);
  });

  it('answers 404, not 403, for a post in another brand', async () => {
    postGetMock.mockResolvedValue({ exists: true, data: () => publishedPost({ productId: 'prod_other' }) });

    const response = await call(POST_ID);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('NOT_FOUND');
  });

  it('answers 404 for drafts, sandbox posts, missing posts, and malformed ids', async () => {
    postGetMock.mockResolvedValue({ exists: true, data: () => publishedPost({ status: 'draft' }) });
    expect((await call(POST_ID)).status).toBe(404);

    postGetMock.mockResolvedValue({ exists: true, data: () => publishedPost({ testMode: true }) });
    expect((await call(POST_ID)).status).toBe(404);

    postGetMock.mockResolvedValue({ exists: false, data: () => undefined });
    expect((await call(POST_ID)).status).toBe(404);

    postGetMock.mockClear();
    expect((await call('not%20an%20id')).status).toBe(404);
    expect(postGetMock).not.toHaveBeenCalled();
  });
});
