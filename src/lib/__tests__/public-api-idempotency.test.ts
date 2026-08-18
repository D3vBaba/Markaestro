import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredDoc = Record<string, unknown>;
const store = new Map<string, StoredDoc>();

function ref(path: string) {
  return {
    path,
    get: vi.fn(async () => ({
      exists: store.has(path),
      data: () => store.get(path),
    })),
    set: vi.fn(async (data: StoredDoc) => {
      store.set(path, { ...(store.get(path) || {}), ...data });
    }),
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: vi.fn((path: string) => ref(path)),
    runTransaction: vi.fn(async (fn: (tx: {
      get: (document: ReturnType<typeof ref>) => Promise<{ exists: boolean; data: () => StoredDoc | undefined }>;
      set: (document: ReturnType<typeof ref>, data: StoredDoc) => void;
    }) => Promise<unknown>) => {
      const writes: Array<{ path: string; data: StoredDoc }> = [];
      const result = await fn({
        get: async (document) => ({
          exists: store.has(document.path),
          data: () => store.get(document.path),
        }),
        set: (document, data) => writes.push({ path: document.path, data }),
      });
      for (const write of writes) {
        store.set(write.path, { ...(store.get(write.path) || {}), ...write.data });
      }
      return result;
    }),
  },
}));

describe('public API idempotency reservations', () => {
  beforeEach(() => store.clear());

  it('reserves a hashed document and blocks a concurrent duplicate', async () => {
    const { loadIdempotentResponse } = await import('../public-api/idempotency');
    const first = await loadIdempotentResponse('ws_1', 'client/key', 'hash_1');
    const second = await loadIdempotentResponse('ws_1', 'client/key', 'hash_1');

    expect(first).toBeNull();
    expect(second?.status).toBe(409);
    expect([...store.keys()]).toHaveLength(1);
    expect([...store.keys()][0]).toMatch(/^workspaces\/ws_1\/idempotency_keys\/[a-f0-9]{64}$/);
  });

  it('replays the completed response without executing the operation again', async () => {
    const { loadIdempotentResponse, persistIdempotentResponse } = await import('../public-api/idempotency');
    expect(await loadIdempotentResponse('ws_1', 'request_1', 'hash_1')).toBeNull();
    await persistIdempotentResponse('ws_1', 'request_1', 'hash_1', 201, { id: 'post_1' });

    const replay = await loadIdempotentResponse('ws_1', 'request_1', 'hash_1');
    expect(replay?.status).toBe(201);
    expect(await replay?.json()).toEqual({ id: 'post_1' });
  });

  it('rejects reuse of one key for a different request body', async () => {
    const { loadIdempotentResponse } = await import('../public-api/idempotency');
    await loadIdempotentResponse('ws_1', 'request_1', 'hash_1');
    await expect(loadIdempotentResponse('ws_1', 'request_1', 'hash_2'))
      .rejects.toThrow('VALIDATION_IDEMPOTENCY_KEY_REUSED');
  });
});
