import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every mutating post route was single-resource, so an agency rescheduling a
 * week of posts after a product delay did it one at a time through dozens of
 * round trips, with no atomicity and no way to see what failed.
 *
 * The contract these tests pin down is partial success. With 25 heterogeneous
 * posts, some legitimately cannot take the operation, and refusing the whole
 * batch for one of them would make the endpoint unusable.
 */

const docs = new Map<string, Record<string, unknown>>();
const deleted: string[] = [];
const setCalls: Array<{ path: string; payload: Record<string, unknown> }> = [];
const releasePostMediaMock = vi.fn<(workspaceId: string, mediaUrls: unknown) => Promise<void>>(
  async () => undefined,
);
const markWorkspaceDueMock = vi.fn<(workspaceId: string, dueAt: unknown, reason: string) => Promise<void>>(
  async () => undefined,
);

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({
      path,
      get: async () => ({
        exists: docs.has(path),
        data: () => docs.get(path),
      }),
      delete: async () => { deleted.push(path); docs.delete(path); },
      set: async (payload: Record<string, unknown>) => { setCalls.push({ path, payload }); },
    }),
  },
}));

vi.mock('@/lib/media/asset-store', () => ({
  releasePostMedia: (workspaceId: string, mediaUrls: unknown) =>
    releasePostMediaMock(workspaceId, mediaUrls),
}));

vi.mock('@/lib/workers/due-workspaces', () => ({
  markWorkspaceDue: (workspaceId: string, dueAt: unknown, reason: string) =>
    markWorkspaceDueMock(workspaceId, dueAt, reason),
}));

function seed(id: string, data: Record<string, unknown>) {
  docs.set(`workspaces/ws1/posts/${id}`, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  docs.clear();
  deleted.length = 0;
  setCalls.length = 0;
});

async function apply(ids: string[], operation: Parameters<
  typeof import('@/lib/social/bulk-post-operations')['applyBulkPostOperation']
>[3]) {
  const { applyBulkPostOperation } = await import('@/lib/social/bulk-post-operations');
  return applyBulkPostOperation('ws1', 'uid1', ids, operation);
}

describe('applyBulkPostOperation', () => {
  it('reschedules every eligible post and reports the ones it could not', async () => {
    seed('a', { status: 'scheduled', scheduledAt: '2026-09-01T00:00:00.000Z' });
    seed('b', { status: 'published' });

    const result = await apply(['a', 'b', 'missing'], {
      action: 'reschedule',
      scheduledAt: '2026-09-05T10:00:00.000Z',
    });

    expect(result.succeeded).toEqual(['a']);
    expect(result.failed).toEqual([
      { id: 'b', error: 'VALIDATION_POST_ALREADY_PUBLISHED' },
      { id: 'missing', error: 'NOT_FOUND' },
    ]);
  });

  it('refuses to reschedule a published post rather than rewriting history', async () => {
    // Moving a published post's scheduledAt changes nothing on the platform,
    // so the record would simply stop matching what went out.
    seed('a', { status: 'published' });
    const result = await apply(['a'], { action: 'reschedule', scheduledAt: '2026-09-05T10:00:00.000Z' });
    expect(result.succeeded).toEqual([]);
  });

  it('will not touch a post the publisher is currently holding', async () => {
    seed('a', {
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await apply(['a'], { action: 'delete' });

    expect(result.failed[0].error).toBe('VALIDATION_POST_IS_PUBLISHING');
    expect(deleted).toEqual([]);
  });

  it('still deletes a post whose publish lease has expired', async () => {
    // A post stuck in `publishing` because an instance died must stay
    // deletable, or the guard becomes its own trap.
    seed('a', {
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await apply(['a'], { action: 'delete' });

    expect(result.succeeded).toEqual(['a']);
  });

  it('releases media on delete, so bulk delete frees storage like single delete', async () => {
    seed('a', { status: 'draft', mediaUrls: ['https://example.com/a.jpg'] });

    await apply(['a'], { action: 'delete' });

    expect(releasePostMediaMock).toHaveBeenCalledWith('ws1', ['https://example.com/a.jpg']);
  });

  it('marks the workspace due once for the batch, not once per post', async () => {
    seed('a', { status: 'draft' });
    seed('b', { status: 'draft' });

    await apply(['a', 'b'], { action: 'reschedule', scheduledAt: '2026-09-05T10:00:00.000Z' });

    expect(markWorkspaceDueMock).toHaveBeenCalledTimes(1);
    expect(markWorkspaceDueMock).toHaveBeenCalledWith('ws1', '2026-09-05T10:00:00.000Z', 'scheduled_post');
  });

  it('does not wake the worker when nothing was rescheduled', async () => {
    seed('a', { status: 'published' });
    await apply(['a'], { action: 'reschedule', scheduledAt: '2026-09-05T10:00:00.000Z' });
    expect(markWorkspaceDueMock).not.toHaveBeenCalled();
  });

  it('refuses to schedule a post that has no time to schedule to', async () => {
    seed('a', { status: 'draft' });
    const result = await apply(['a'], { action: 'status', status: 'scheduled' });
    expect(result.failed[0].error).toBe('VALIDATION_SCHEDULED_AT_REQUIRED');
  });

  it('normalizes the reschedule timestamp to ISO 8601', async () => {
    seed('a', { status: 'draft' });
    await apply(['a'], { action: 'reschedule', scheduledAt: '2026-09-05T10:00:00Z' });
    expect(setCalls[0].payload.scheduledAt).toBe('2026-09-05T10:00:00.000Z');
  });
});

describe('bulkPostOperationSchema', () => {
  it('bounds a batch at the same 25 as the batch-create schema', async () => {
    const { bulkPostOperationSchema } = await import('@/lib/social/bulk-post-schema');
    const ids = Array.from({ length: 26 }, (_, i) => `p${i}`);
    expect(() => bulkPostOperationSchema.parse({ ids, action: 'delete' })).toThrow();
    expect(() => bulkPostOperationSchema.parse({ ids: ids.slice(0, 25), action: 'delete' })).not.toThrow();
  });

  it('requires a timestamp for a reschedule', async () => {
    const { bulkPostOperationSchema } = await import('@/lib/social/bulk-post-schema');
    expect(() => bulkPostOperationSchema.parse({ ids: ['a'], action: 'reschedule' })).toThrow();
  });

  it('rejects an empty batch rather than answering an empty success', async () => {
    const { bulkPostOperationSchema } = await import('@/lib/social/bulk-post-schema');
    expect(() => bulkPostOperationSchema.parse({ ids: [], action: 'delete' })).toThrow();
  });
});
