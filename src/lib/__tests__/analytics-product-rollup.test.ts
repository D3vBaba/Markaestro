import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 5.10: the per-brand analytics view (the one an agency uses most) was the
 * slow path: workspace-wide totals read precomputed `analyticsDaily` docs
 * while a product filter re-derived everything from post rows per request.
 * The rollup now carries a `byProduct` dimension.
 *
 * The correctness edge these tests exist for is the rollout boundary: a
 * window that spans docs written before the field existed must fall back to
 * rows for the whole window, never mix the two populations.
 */

const setMock = vi.fn();
const getAllMatchingDocsMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: (path: string) => ({ path, set: (data: unknown) => setMock(path, data) }), collection: () => ({ where: function w() { return { where: w, get: async () => ({ docs: [] }) }; } }) },
}));
vi.mock('@/lib/firestore-pagination', () => ({
  getAllMatchingDocs: (...args: unknown[]) => getAllMatchingDocsMock(...args),
}));

function postDoc(data: Record<string, unknown>) {
  return { data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recomputeDailyAggregates byProduct', () => {
  it('rolls the same day up per brand alongside the workspace totals', async () => {
    getAllMatchingDocsMock.mockResolvedValue([
      postDoc({
        productId: 'brand_a',
        channel: 'instagram',
        publishedChannels: ['instagram'],
        metricsByChannel: { instagram: { views: 100, reach: 80, likes: 10, comments: 1, shares: 0, saves: 2, clicks: 5 } },
      }),
      postDoc({
        productId: 'brand_b',
        channel: 'instagram',
        publishedChannels: ['instagram'],
        metricsByChannel: { instagram: { views: 40, reach: 30, likes: 4, comments: 0, shares: 1, saves: 0, clicks: 2 } },
      }),
    ]);

    const { recomputeDailyAggregates } = await import('../analytics/aggregates');
    await recomputeDailyAggregates('ws1', ['2026-08-29']);

    expect(setMock).toHaveBeenCalledOnce();
    const [path, doc] = setMock.mock.calls[0] as [string, {
      posts: number;
      channels: Record<string, { views: number }>;
      byProduct: Record<string, { posts: number; channels: Record<string, { views: number }> }>;
    }];
    expect(path).toBe('workspaces/ws1/analyticsDaily/2026-08-29');
    // Workspace-wide stays what it was.
    expect(doc.posts).toBe(2);
    expect(doc.channels.instagram.views).toBe(140);
    // And each brand sees only its own.
    expect(doc.byProduct.brand_a.posts).toBe(1);
    expect(doc.byProduct.brand_a.channels.instagram.views).toBe(100);
    expect(doc.byProduct.brand_b.channels.instagram.views).toBe(40);
  });

  it('keeps sandbox posts out of both dimensions', async () => {
    getAllMatchingDocsMock.mockResolvedValue([
      postDoc({ productId: 'brand_a', channel: 'linkedin', testMode: true }),
    ]);

    const { recomputeDailyAggregates } = await import('../analytics/aggregates');
    await recomputeDailyAggregates('ws1', ['2026-08-29']);

    const [, doc] = setMock.mock.calls[0] as [string, { posts: number; byProduct: Record<string, unknown> }];
    expect(doc.posts).toBe(0);
    expect(doc.byProduct).toEqual({});
  });

  it('writes an empty byProduct map rather than omitting it, so the query layer can tell "no posts" from "predates the rollup"', async () => {
    getAllMatchingDocsMock.mockResolvedValue([]);

    const { recomputeDailyAggregates } = await import('../analytics/aggregates');
    await recomputeDailyAggregates('ws1', ['2026-08-29']);

    const [, doc] = setMock.mock.calls[0] as [string, { byProduct?: unknown }];
    expect(doc.byProduct).toEqual({});
  });
});

describe('recomputeDailyAggregates with native posts', () => {
  it('rolls posts published directly on the platform into the same day, counting a shared post once', async () => {
    getAllMatchingDocsMock
      .mockResolvedValueOnce([
        postDoc({
          productId: 'brand_a',
          channel: 'instagram',
          publishedChannels: ['instagram'],
          publishResults: [{ channel: 'instagram', success: true, externalId: 'ig_shared' }],
          metricsByChannel: { instagram: { views: 100, reach: 80, likes: 10, comments: 1, shares: 0, saves: 2, clicks: 5 } },
        }),
      ])
      .mockResolvedValueOnce([
        postDoc({
          provenance: 'platform_native', platform: 'instagram', externalId: 'ig_native', productId: 'brand_a',
          metricsByChannel: { instagram: { views: 50, reach: 40, likes: 5, comments: 0, shares: 0, saves: 0, clicks: 1 } },
        }),
        postDoc({
          provenance: 'platform_native', platform: 'instagram', externalId: 'ig_shared', productId: 'brand_a',
          metricsByChannel: { instagram: { views: 100, reach: 80, likes: 10, comments: 1, shares: 0, saves: 2, clicks: 5 } },
        }),
        // Projected from a Markaestro post by the poller; not a native post.
        postDoc({ provenance: 'markaestro', platform: 'instagram', externalId: 'ig_mk', productId: 'brand_a' }),
      ]);

    const { recomputeDailyAggregates } = await import('../analytics/aggregates');
    await recomputeDailyAggregates('ws1', ['2026-09-05']);

    const [, doc] = setMock.mock.calls[0] as [string, {
      posts: number;
      channels: Record<string, { posts: number; views: number; likes: number }>;
      byProduct: Record<string, { posts: number; channels: Record<string, { views: number }> }>;
    }];
    expect(doc.posts).toBe(2);
    expect(doc.channels.instagram).toEqual(expect.objectContaining({ posts: 2, views: 150, likes: 15 }));
    expect(doc.byProduct.brand_a).toEqual(expect.objectContaining({ posts: 2 }));
    expect(doc.byProduct.brand_a.channels.instagram.views).toBe(150);
  });
});
