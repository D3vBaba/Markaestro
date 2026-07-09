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
