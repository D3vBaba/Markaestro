import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Five routes charged an AI operation by hand and two of them refunded it by
 * hand, so a Vertex 503 on `/strategist` silently cost the customer a turn
 * they never got an answer for, and an async job that died in the worker
 * never gave its operation back at all.
 *
 * The invariant: a charge is refunded exactly when the work it paid for did
 * not happen, and never otherwise.
 */

type UsageDoc = { aiOperations?: number; strategistTurns?: number };

const store = new Map<string, UsageDoc>();

const docMock = vi.fn((path: string) => ({ path }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: docMock,
    runTransaction: async (callback: (tx: {
      get: (ref: { path: string }) => Promise<{ data: () => UsageDoc | undefined }>;
      set: (ref: { path: string }, value: UsageDoc, options?: unknown) => void;
    }) => unknown) => callback({
      get: async (ref) => ({ data: () => store.get(ref.path) }),
      set: (ref, value) => {
        store.set(ref.path, { ...(store.get(ref.path) || {}), ...value });
      },
    }),
  },
}));

const MONTH = '2026-08';
const NOW = new Date(`${MONTH}-15T00:00:00.000Z`);
const PATH = `workspaces/ws1/aiUsageDaily/${MONTH}`;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('withAiOperation', () => {
  it('charges once and keeps the charge when the work succeeds', async () => {
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    const result = await withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: 10, now: NOW },
      async () => 'generated',
    );

    expect(result).toBe('generated');
    expect(store.get(PATH)?.aiOperations).toBe(1);
  });

  it('gives the operation back when the model call fails', async () => {
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    await expect(withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: 10, now: NOW },
      async () => { throw new Error('VERTEX_UNAVAILABLE'); },
    )).rejects.toThrow('VERTEX_UNAVAILABLE');

    expect(store.get(PATH)?.aiOperations).toBe(0);
  });

  it('rethrows the original error, not the refund outcome', async () => {
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    await expect(withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: 10, now: NOW },
      async () => { throw new Error('AI_FINGERPRINT_KIND_MISMATCH'); },
    )).rejects.toThrow('AI_FINGERPRINT_KIND_MISMATCH');
  });

  it('charges and refunds strategist turns on their own counter', async () => {
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    await expect(withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: 5, kind: 'strategist', now: NOW },
      async () => { throw new Error('VERTEX_UNAVAILABLE'); },
    )).rejects.toThrow('VERTEX_UNAVAILABLE');

    expect(store.get(PATH)?.strategistTurns).toBe(0);
    // The operations counter must not move for a strategist turn.
    expect(store.get(PATH)?.aiOperations).toBeUndefined();
  });

  it('does not refund a quota rejection, which never charged anything', async () => {
    store.set(PATH, { aiOperations: 10 });
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    await expect(withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: 10, now: NOW },
      async () => 'never runs',
    )).rejects.toThrow('QUOTA_EXCEEDED');

    // A refund here would hand out a free operation per rejected call.
    expect(store.get(PATH)?.aiOperations).toBe(10);
  });

  it('never lets the counter go negative', async () => {
    const { refundAiOperation } = await import('@/lib/intelligence/usage');

    await refundAiOperation({ workspaceId: 'ws1', now: NOW });
    await refundAiOperation({ workspaceId: 'ws1', now: NOW });

    expect(store.get(PATH)?.aiOperations).toBe(0);
  });

  it('treats an unlimited allowance as never exceeded', async () => {
    store.set(PATH, { aiOperations: 9_999 });
    const { withAiOperation } = await import('@/lib/intelligence/usage');

    await expect(withAiOperation(
      { workspaceId: 'ws1', uid: 'u1', monthlyLimit: -1, now: NOW },
      async () => 'ok',
    )).resolves.toBe('ok');
  });
});
