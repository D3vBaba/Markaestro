import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsPostRow } from '@/lib/analytics/api-shape';

const requirePublicApiContextMock = vi.fn();
const fetchPostRowsForExportMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

vi.mock('@/lib/analytics/query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/analytics/query')>('@/lib/analytics/query');
  return { ...actual, fetchPostRowsForExport: fetchPostRowsForExportMock };
});

function row(id: string, publishedAt: string, metrics: Partial<AnalyticsPostRow> = {}): AnalyticsPostRow {
  return {
    id,
    content: `post ${id}`,
    channels: ['instagram'],
    publishedAt,
    externalUrl: null,
    productId: 'prod_1',
    contentType: 'image',
    source: 'markaestro',
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    engagements: null,
    erByReach: null,
    erByViews: null,
    ...metrics,
  };
}

function call(query = '') {
  return import('./route').then(({ GET }) => GET(new Request(`http://localhost/api/public/v1/analytics/posts${query}`)));
}

describe('GET /api/public/v1/analytics/posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockResolvedValue({
      principalType: 'api_client',
      workspaceId: 'ws_1',
      clientId: 'cli_1',
      productId: 'prod_1',
      planTier: 'business',
      rateLimitHeaders: { 'X-RateLimit-Limit': '20' },
    });
    fetchPostRowsForExportMock.mockResolvedValue([
      row('a', '2026-08-01T10:00:00.000Z', { views: 10, engagements: 5, reach: 100, erByReach: 0.05 }),
      row('b', '2026-08-15T10:00:00.000Z', { views: null, engagements: 9, reach: null, erByViews: null }),
      row('c', '2026-08-20T10:00:00.000Z', { views: 30, engagements: 1, reach: 20, erByReach: 0.05 }),
    ]);
  });

  it('requires analytics.read and reads only the key’s brand', async () => {
    const response = await call('?days=90&channel=instagram');

    expect(response.status).toBe(200);
    expect(requirePublicApiContextMock).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ scope: 'analytics.read' }),
    );
    // (workspace, sinceIso, channel, productId): the brand comes from the key, never the query.
    expect(fetchPostRowsForExportMock).toHaveBeenCalledWith('ws_1', expect.stringMatching(/T00:00:00\.000Z$/), 'instagram', 'prod_1', undefined);
    const body = await response.json();
    expect(body.sort).toBe('published_at');
    expect(body.posts.map((post: AnalyticsPostRow) => post.id)).toEqual(['c', 'b', 'a']);
    expect(body.count).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.window).toEqual(expect.objectContaining({ days: 90, maxDays: -1, tier: 'business' }));
  });

  it('sorts by a metric with missing values last, and truncates to limit', async () => {
    const response = await call('?sort=views&limit=2');

    const body = await response.json();
    expect(body.posts.map((post: AnalyticsPostRow) => post.id)).toEqual(['c', 'a']);
    expect(body.count).toBe(2);
    expect(body.truncated).toBe(true);
  });

  it('breaks engagement-rate ties by recency and never lets a null outrank a number', async () => {
    const response = await call('?sort=engagement_rate');

    const body = await response.json();
    expect(body.posts.map((post: AnalyticsPostRow) => post.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops posts published after an explicit range that ends before today', async () => {
    const response = await call('?since=2026-08-01&until=2026-08-10');

    const body = await response.json();
    expect(body.posts.map((post: AnalyticsPostRow) => post.id)).toEqual(['a']);
    expect(body.window).toEqual(expect.objectContaining({ since: '2026-08-01', until: '2026-08-10', days: 10 }));
  });

  it('passes the source filter to the row fetch', async () => {
    const response = await call('?source=native');
    expect(response.status).toBe(200);
    expect(fetchPostRowsForExportMock).toHaveBeenCalledWith('ws_1', expect.any(String), undefined, 'prod_1', 'native');
  });

  it('rejects an unknown sort key', async () => {
    const response = await call('?sort=random');

    expect(response.status).toBe(400);
    expect(fetchPostRowsForExportMock).not.toHaveBeenCalled();
  });
});
