import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const docMock = vi.fn();
const runTransactionMock = vi.fn();
const transactionGetMock = vi.fn();
const transactionSetMock = vi.fn();
const transactionDeleteMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: docMock,
    runTransaction: runTransactionMock,
  },
}));

describe('due workspace records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docMock.mockImplementation((path: string) => ({ path }));
    runTransactionMock.mockImplementation(async (callback: (tx: {
      get: typeof transactionGetMock;
      set: typeof transactionSetMock;
      delete: typeof transactionDeleteMock;
    }) => unknown) => callback({
      get: transactionGetMock,
      set: transactionSetMock,
      delete: transactionDeleteMock,
    }));
  });

  it('keeps the earliest due time and increments the version', async () => {
    transactionGetMock.mockResolvedValue({
      data: () => ({ nextDueAt: Timestamp.fromMillis(2_000), version: 7 }),
    });
    const { markWorkspaceDue } = await import('./due-workspaces');

    await markWorkspaceDue('ws_1', 1_000, 'scheduled_post');

    const update = transactionSetMock.mock.calls[0][1];
    expect(update.workspaceId).toBe('ws_1');
    expect(update.nextDueAt.toMillis()).toBe(1_000);
    expect(update.version).toBe(8);
  });

  it('queues follow-up work separately while a dispatch claim is active', async () => {
    transactionGetMock.mockResolvedValue({
      data: () => ({
        nextDueAt: Timestamp.fromMillis(1_000),
        dispatchLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
        version: 7,
      }),
    });
    const { markWorkspaceDue } = await import('./due-workspaces');

    await markWorkspaceDue('ws_1', 3_000, 'analytics');

    const update = transactionSetMock.mock.calls[0][1];
    expect(update.nextDueAt).toBeUndefined();
    expect(update.pendingNextDueAt.toMillis()).toBe(3_000);
    expect(update.version).toBe(8);
  });

  it('keeps the earliest follow-up time during an active dispatch', async () => {
    transactionGetMock.mockResolvedValue({
      data: () => ({
        nextDueAt: Timestamp.fromMillis(1_000),
        pendingNextDueAt: Timestamp.fromMillis(3_000),
        dispatchLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
        version: 8,
      }),
    });
    const { markWorkspaceDue } = await import('./due-workspaces');

    await markWorkspaceDue('ws_1', 4_000, 'daily_job');

    const update = transactionSetMock.mock.calls[0][1];
    expect(update.pendingNextDueAt.toMillis()).toBe(3_000);
    expect(update.version).toBe(9);
  });

  it('deletes a completed claim only when no newer work was added', async () => {
    transactionGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ dispatchLeaseId: 'lease_1', version: 4 }),
    });
    const { completeWorkspaceDue } = await import('./due-workspaces');

    await completeWorkspaceDue({
      workspaceId: 'ws_1',
      version: 4,
      leaseId: 'lease_1',
      source: 'due',
    });

    expect(transactionDeleteMock).toHaveBeenCalledOnce();
    expect(transactionSetMock).not.toHaveBeenCalled();
  });

  it('retains the record when work arrives during processing', async () => {
    transactionGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ dispatchLeaseId: 'lease_1', version: 5 }),
    });
    const { completeWorkspaceDue } = await import('./due-workspaces');

    await completeWorkspaceDue({
      workspaceId: 'ws_1',
      version: 4,
      leaseId: 'lease_1',
      source: 'due',
    });

    expect(transactionDeleteMock).not.toHaveBeenCalled();
    expect(transactionSetMock).toHaveBeenCalledOnce();
  });

  it('promotes queued follow-up work after the current claim completes', async () => {
    transactionGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        nextDueAt: Timestamp.fromMillis(1_000),
        pendingNextDueAt: Timestamp.fromMillis(3_000),
        dispatchLeaseId: 'lease_1',
        version: 5,
      }),
    });
    const { completeWorkspaceDue } = await import('./due-workspaces');

    await completeWorkspaceDue({
      workspaceId: 'ws_1',
      version: 4,
      leaseId: 'lease_1',
      source: 'due',
    });

    expect(transactionDeleteMock).not.toHaveBeenCalled();
    expect(transactionSetMock).toHaveBeenCalledOnce();
    const update = transactionSetMock.mock.calls[0][1];
    expect(update.nextDueAt.toMillis()).toBe(3_000);
    expect(update.pendingNextDueAt.isEqual(FieldValue.delete())).toBe(true);
    expect(update.dispatchLeaseId.isEqual(FieldValue.delete())).toBe(true);
    expect(update.dispatchLeaseUntil.isEqual(FieldValue.delete())).toBe(true);
  });
});
