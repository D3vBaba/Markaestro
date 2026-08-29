import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The gallery's space-reclaim queries (sort by size, unused-only). What
 * matters is that these are QUERY-level, not memory-level: filtering after
 * the fetch would let `limit` count assets the caller never sees, and a
 * "largest first" that only sorts the newest 30 is not largest first.
 */

const executeListQueryPageMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (path: string) => ({ path }) },
}));
vi.mock('@/lib/firestore-list-query', () => ({
  executeListQueryPage: (...args: unknown[]) => executeListQueryPageMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  executeListQueryPageMock.mockResolvedValue({ items: [], nextCursor: null });
});

describe('listMediaAssets gallery options', () => {
  it('orders by size at the query when the gallery asks for largest first', async () => {
    const { listMediaAssets } = await import('../media/asset-store');
    await listMediaAssets('ws1', { sort: 'largest' });
    const [, options] = executeListQueryPageMock.mock.calls[0];
    expect(options).toMatchObject({ orderByField: 'sizeBytes', orderByDirection: 'desc' });
  });

  it('defaults to newest first, unchanged for every existing caller', async () => {
    const { listMediaAssets } = await import('../media/asset-store');
    await listMediaAssets('ws1', {});
    const [, options] = executeListQueryPageMock.mock.calls[0];
    expect(options).toMatchObject({ orderByField: 'createdAt', orderByDirection: 'desc' });
  });

  it('expresses unused-only as a refCount filter, not a memory filter', async () => {
    const { listMediaAssets } = await import('../media/asset-store');
    await listMediaAssets('ws1', { unusedOnly: true, sort: 'largest' });
    const [, options] = executeListQueryPageMock.mock.calls[0];
    expect(options.filters).toEqual([{ field: 'refCount', op: '==', value: 0 }]);
    expect(options.orderByField).toBe('sizeBytes');
  });

  it('keeps type filtering compatible with the size sort', async () => {
    const { listMediaAssets } = await import('../media/asset-store');
    await listMediaAssets('ws1', { type: 'video', sort: 'largest' });
    const [, options] = executeListQueryPageMock.mock.calls[0];
    expect(options.filters).toEqual([{ field: 'type', op: '==', value: 'video' }]);
    expect(options.orderByField).toBe('sizeBytes');
  });
});
