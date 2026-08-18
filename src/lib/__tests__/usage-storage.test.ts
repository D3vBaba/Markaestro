import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so mocks are available inside the vi.mock factory
const { state, mockRunTransaction, mockCollection } = vi.hoisted(() => {
  const state = {
    usageDocs: {} as Record<string, Record<string, unknown>>,
    aggregateSumBytes: 0,
    aggregateCalls: 0,
  };

  function makeDocRef(id: string) {
    return {
      id,
      get: async () => ({
        exists: id in state.usageDocs,
        data: () => state.usageDocs[id],
      }),
      set: async (data: Record<string, unknown>) => {
        state.usageDocs[id] = { ...state.usageDocs[id], ...data };
      },
    };
  }
  type DocRef = ReturnType<typeof makeDocRef>;

  const mockCollection = vi.fn((path: string) => {
    if (path === 'usage') return { doc: (id: string) => makeDocRef(id) };
    if (/^workspaces\/[^/]+\/media_assets$/.test(path)) {
      return {
        aggregate: () => ({
          get: async () => {
            state.aggregateCalls += 1;
            return { data: () => ({ storageBytes: state.aggregateSumBytes }) };
          },
        }),
      };
    }
    throw new Error(`unexpected collection: ${path}`);
  });

  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: DocRef) => ref.get(),
      set: (ref: DocRef, data: Record<string, unknown>) => {
        state.usageDocs[ref.id] = { ...state.usageDocs[ref.id], ...data };
      },
    };
    return fn(tx);
  });

  return { state, mockRunTransaction, mockCollection };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  AggregateField: { sum: (field: string) => ({ field }) },
  FieldValue: { increment: (n: number) => ({ increment: n }) },
}));

import { BYTES_PER_GB, getUsage, refundStorage, reserveStorage, storageLimitBytes } from '../usage';

const GB = BYTES_PER_GB;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(state.usageDocs)) delete state.usageDocs[key];
  state.aggregateSumBytes = 0;
  state.aggregateCalls = 0;
});

describe('storageLimitBytes', () => {
  it('converts the plan cap to bytes and passes -1 (unlimited) through', () => {
    expect(storageLimitBytes({ storageGb: 1 })).toBe(GB);
    expect(storageLimitBytes({ storageGb: 10 })).toBe(10 * GB);
    expect(storageLimitBytes({ storageGb: -1 })).toBe(-1);
  });
});

describe('reserveStorage', () => {
  it('accumulates bytes under the cap in the workspace-scoped doc', async () => {
    state.usageDocs['workspace:ws_1'] = { storageBytes: 100 };

    const result = await reserveStorage('ws_1', 50, { storageGb: 1 });

    expect(result).toEqual({ allowed: true, currentBytes: 150, limitBytes: GB });
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(150);
  });

  it('refuses a reservation that would exceed the cap and leaves usage unchanged', async () => {
    state.usageDocs['workspace:ws_1'] = { storageBytes: GB - 10 };

    const result = await reserveStorage('ws_1', 11, { storageGb: 1 });

    expect(result).toEqual({
      allowed: false,
      currentBytes: GB - 10,
      limitBytes: GB,
      reason: 'quota_exceeded',
    });
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(GB - 10);
  });

  it('refuses even a zero-byte reservation once usage sits above the cap', async () => {
    // A downgraded workspace over its new cap must not mint upload URLs
    // with no declared size to sneak past the check.
    state.usageDocs['workspace:ws_1'] = { storageBytes: 2 * GB };

    const result = await reserveStorage('ws_1', 0, { storageGb: 1 });
    expect(result.allowed).toBe(false);
  });

  it('always allows unlimited plans but still records the footprint', async () => {
    const result = await reserveStorage('ws_1', 5 * GB, { storageGb: -1 });

    expect(result).toEqual({ allowed: true, currentBytes: 5 * GB, limitBytes: -1 });
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(5 * GB);
  });

  it('lazily initializes legacy docs from the media_assets aggregate, once', async () => {
    state.usageDocs['workspace:ws_legacy'] = { '2026-08_posts': 3 }; // no storageBytes yet
    state.aggregateSumBytes = 5_000;

    const first = await reserveStorage('ws_legacy', 100, { storageGb: 1 });
    expect(first).toEqual({ allowed: true, currentBytes: 5_100, limitBytes: GB });
    expect(state.usageDocs['workspace:ws_legacy'].storageBytes).toBe(5_100);
    expect(state.aggregateCalls).toBe(1);

    // Once the field exists the aggregate is never consulted again.
    await reserveStorage('ws_legacy', 100, { storageGb: 1 });
    expect(state.aggregateCalls).toBe(1);
  });

  it('persists the legacy baseline even when the reservation is refused', async () => {
    state.aggregateSumBytes = 2 * GB;

    const result = await reserveStorage('ws_legacy', 1, { storageGb: 1 });

    expect(result.allowed).toBe(false);
    expect(result.currentBytes).toBe(2 * GB);
    expect(state.usageDocs['workspace:ws_legacy'].storageBytes).toBe(2 * GB);
  });
});

describe('refundStorage', () => {
  it('decrements the counter and clamps at zero', async () => {
    state.usageDocs['workspace:ws_1'] = { storageBytes: 500 };

    await refundStorage('ws_1', 200);
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(300);

    await refundStorage('ws_1', 10_000);
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(0);
  });

  it('ignores zero and negative refunds', async () => {
    state.usageDocs['workspace:ws_1'] = { storageBytes: 500 };
    await refundStorage('ws_1', 0);
    await refundStorage('ws_1', -50);
    expect(state.usageDocs['workspace:ws_1'].storageBytes).toBe(500);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('initializes a legacy doc from the aggregate instead of clamping to zero', async () => {
    // Deleting media before the first metered upload: the media doc is
    // already gone, so the aggregate is the correct post-delete footprint.
    state.aggregateSumBytes = 2_000;

    await refundStorage('ws_legacy', 500);
    expect(state.usageDocs['workspace:ws_legacy'].storageBytes).toBe(2_000);
  });
});

describe('getUsage', () => {
  it('returns the month posts counter and cumulative storage bytes', async () => {
    const month = new Date().toISOString().slice(0, 7);
    state.usageDocs['workspace:ws_1'] = { [`${month}_posts`]: 4, storageBytes: 1_234 };

    await expect(getUsage('user_1', 'ws_1')).resolves.toEqual({ posts: 4, storageBytes: 1_234 });
  });

  it('lazily initializes and persists storage for legacy docs', async () => {
    const month = new Date().toISOString().slice(0, 7);
    state.usageDocs['workspace:ws_legacy'] = { [`${month}_posts`]: 2 };
    state.aggregateSumBytes = 9_999;

    await expect(getUsage('user_1', 'ws_legacy')).resolves.toEqual({ posts: 2, storageBytes: 9_999 });
    expect(state.usageDocs['workspace:ws_legacy'].storageBytes).toBe(9_999);
  });
});
