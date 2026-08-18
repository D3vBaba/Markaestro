import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

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
});
