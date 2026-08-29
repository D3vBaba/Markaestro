import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/public/v1/job-runs/[id]` could fetch one run by id and nothing
 * could enumerate them, so a client that lost a run id had no way to recover
 * it: the run existed, was still progressing, and was unreachable.
 *
 * The subtle part is brand scoping. A run carries no brand of its own, it
 * inherits the brand of the post it acts on, so a brand-bound key listing runs
 * must not see another brand's runs even though the collection is shared.
 */

const executeListQueryPageMock = vi.fn();
const getPublicPostMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (path: string) => ({ path }) },
}));

vi.mock('@/lib/firestore-list-query', () => ({
  executeListQueryPage: (...args: unknown[]) => executeListQueryPageMock(...args),
}));

vi.mock('@/lib/public-api/posts', () => ({
  getPublicPost: (...args: unknown[]) => getPublicPostMock(...args),
  assertPublicPostInBrandScope: (post: Record<string, unknown>, keyProductId?: string) => {
    if (keyProductId && post.productId !== keyProductId) throw new Error('NOT_FOUND');
  },
}));

function run(id: string, resourceId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'post.publish',
    status: 'queued',
    resourceType: 'post',
    resourceId,
    createdAt: '2026-08-29T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPublicPostMock.mockImplementation(async (_ws: string, postId: string) => {
    if (postId === 'gone') throw new Error('NOT_FOUND');
    return { id: postId, productId: postId === 'post_a' ? 'brand_a' : 'brand_b' };
  });
});

describe('listJobRuns', () => {
  it('returns every run for an unbound workspace key', async () => {
    executeListQueryPageMock.mockResolvedValue({
      items: [run('r1', 'post_a'), run('r2', 'post_b')],
      nextCursor: null,
    });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    const result = await listJobRuns('ws1', undefined);

    expect(result.runs.map((r) => r.id)).toEqual(['r1', 'r2']);
    // An unbound key must not pay for an ownership check it does not need.
    expect(getPublicPostMock).not.toHaveBeenCalled();
  });

  it('hides another brand’s runs from a brand-bound key', async () => {
    executeListQueryPageMock.mockResolvedValue({
      items: [run('r1', 'post_a'), run('r2', 'post_b')],
      nextCursor: null,
    });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    const result = await listJobRuns('ws1', 'brand_a');

    expect(result.runs.map((r) => r.id)).toEqual(['r1']);
  });

  it('drops a run whose post is gone, because ownership is then unprovable', async () => {
    executeListQueryPageMock.mockResolvedValue({
      items: [run('r1', 'gone')],
      nextCursor: null,
    });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    expect((await listJobRuns('ws1', 'brand_a')).runs).toEqual([]);
    // The same run stays visible to an unbound key, which can see the whole
    // workspace anyway.
    expect((await listJobRuns('ws1', undefined)).runs.map((r) => r.id)).toEqual(['r1']);
  });

  it('drops a run that does not act on a post for a bound key', async () => {
    executeListQueryPageMock.mockResolvedValue({
      items: [run('r1', 'post_a', { resourceType: 'export' })],
      nextCursor: null,
    });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    expect((await listJobRuns('ws1', 'brand_a')).runs).toEqual([]);
  });

  it('passes status and resourceId through as query filters, not memory filters', async () => {
    // Filtering after the fetch would let `limit` count runs the caller never
    // sees, returning fewer rows (or none) while more existed.
    executeListQueryPageMock.mockResolvedValue({ items: [], nextCursor: null });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    await listJobRuns('ws1', undefined, { status: 'failed', resourceId: 'post_a', limit: 10 });

    const [, options] = executeListQueryPageMock.mock.calls[0];
    expect(options.filters).toEqual([
      { field: 'status', op: '==', value: 'failed' },
      { field: 'resourceId', op: '==', value: 'post_a' },
    ]);
    expect(options).toMatchObject({ orderByField: 'createdAt', orderByDirection: 'desc', limit: 10 });
  });

  it('carries the cursor through so a client can page past the first run', async () => {
    executeListQueryPageMock.mockResolvedValue({ items: [run('r1', 'post_a')], nextCursor: 'next' });
    const { listJobRuns } = await import('@/lib/public-api/job-runs-list');

    expect((await listJobRuns('ws1', undefined)).nextCursor).toBe('next');
  });
});
