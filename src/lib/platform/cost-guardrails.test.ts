import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dedupeExists: false,
  spent: 0,
  set: vi.fn(),
  create: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (value: number) => ({ increment: value }) },
  Timestamp: { fromMillis: (value: number) => ({ millis: value }) },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (tx: Record<string, unknown>) => Promise<void>) => callback({
      get: async (ref: { path: string }) => ref.path.includes('providerUsageDedupe')
        ? { exists: state.dedupeExists, data: () => ({}) }
        : { exists: true, data: () => ({ estimatedCostUsd: state.spent }) },
      getAll: async (...refs: { path: string }[]) => refs.map(ref => ({ ref, exists: state.dedupeExists })),
      set: state.set,
      create: state.create,
    }),
  },
}));

import { reserveProviderUsage, settleProviderUsage } from './cost-guardrails';

describe('provider cost guardrails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T14:00:00.000Z'));
    state.dedupeExists = false;
    state.spent = 0;
    state.set.mockReset();
    state.create.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('reserves a repeated daily resource read only once', async () => {
    state.dedupeExists = true;
    state.spent = 25;

    await reserveProviderUsage({
      workspaceId: 'workspace-1',
      provider: 'x',
      operation: 'metrics',
      estimatedCostUsd: 0.001,
      hardBudgetUsd: 25,
      dailyDedupeKey: 'post:123',
    });

    expect(state.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'workspaces/workspace-1/providerUsage/2026-09_x' }),
      expect.objectContaining({
        requests: { increment: 1 },
        estimatedCostUsd: { increment: 0 },
        'operations.metrics.estimatedCostUsd': { increment: 0 },
      }),
      { merge: true },
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it('charges and records the first daily resource read', async () => {
    await reserveProviderUsage({
      workspaceId: 'workspace-1',
      provider: 'x',
      operation: 'metrics',
      estimatedCostUsd: 0.001,
      hardBudgetUsd: 25,
      dailyDedupeKey: 'post:123',
    });

    expect(state.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estimatedCostUsd: { increment: 0.001 } }),
      { merge: true },
    );
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('providerUsageDedupe/2026-09-13_x_') }),
      expect.objectContaining({ provider: 'x', day: '2026-09-13', estimatedCostUsd: 0.001 }),
    );
  });

  it('rejects a new charge that would exceed the budget', async () => {
    state.spent = 25;

    await expect(reserveProviderUsage({
      workspaceId: 'workspace-1',
      provider: 'x',
      operation: 'create',
      estimatedCostUsd: 0.015,
      hardBudgetUsd: 25,
    })).rejects.toThrow('CHANNEL_BILLING_ACTION_REQUIRED');

    expect(state.set).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
});


describe('page-read settlement', () => {
  afterEach(() => vi.useRealTimers());

  it('refunds the original month when an empty response crosses midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T23:59:59Z'));
    state.spent = 0;
    state.set.mockClear();
    const reservedAt = await reserveProviderUsage({
      workspaceId: 'workspace-1', provider: 'x', operation: 'list_posts',
      estimatedCostUsd: 0.05, hardBudgetUsd: 25,
    });
    vi.setSystemTime(new Date('2026-10-01T00:00:01Z'));
    await settleProviderUsage({
      workspaceId: 'workspace-1', provider: 'x', operation: 'list_posts',
      reservedCostUsd: 0.05, reservedAt, unitCostUsd: 0.001, resourceKeys: [],
    });
    expect(state.set).toHaveBeenLastCalledWith(
      { path: 'workspaces/workspace-1/providerUsage/2026-09_x' },
      expect.objectContaining({ estimatedCostUsd: { increment: -0.05 } }),
      { merge: true },
    );
  });

  it('settles duplicate resources once and retains the reservation day for deduplication', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:01Z'));
    state.dedupeExists = false;
    state.create.mockClear();
    await settleProviderUsage({
      workspaceId: 'workspace-1', provider: 'x', operation: 'list_posts',
      reservedCostUsd: 0.05, reservedAt: new Date('2026-09-30T23:59:59Z'),
      unitCostUsd: 0.001, resourceKeys: ['post:1', 'post:1'],
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/2026-09-30_x_') }),
      expect.objectContaining({ day: '2026-09-30', estimatedCostUsd: 0.001 }),
    );
    expect(state.set).toHaveBeenLastCalledWith(
      expect.anything(), expect.objectContaining({ estimatedCostUsd: { increment: -0.049 } }), { merge: true },
    );
  });
});
