import { beforeEach, describe, expect, it, vi } from 'vitest';

const pollPendingTikTokPublishesMock = vi.fn();
const processTokenRefreshMock = vi.fn();
const cleanupExpiredOAuthStatesMock = vi.fn();
const getAllDocsMock = vi.fn();
const processWorkspaceTickMock = vi.fn();
const acquireWorkerLeaseMock = vi.fn();
const releaseWorkerLeaseMock = vi.fn();
const claimDueWorkspacesMock = vi.fn();
const claimPeriodicWorkerPhaseMock = vi.fn();
const cloudTasksDispatchEnabledMock = vi.fn();
const completeWorkspaceDueMock = vi.fn();
const enqueueWorkspaceTaskMock = vi.fn();
const releaseWorkspaceDueClaimMock = vi.fn();

vi.mock('@/lib/workers/lease', () => ({
  acquireWorkerLease: acquireWorkerLeaseMock,
  releaseWorkerLease: releaseWorkerLeaseMock,
}));

vi.mock('@/lib/workers/due-workspaces', () => ({
  claimDueWorkspaces: claimDueWorkspacesMock,
  claimPeriodicWorkerPhase: claimPeriodicWorkerPhaseMock,
  cloudTasksDispatchEnabled: cloudTasksDispatchEnabledMock,
  completeWorkspaceDue: completeWorkspaceDueMock,
  enqueueWorkspaceTask: enqueueWorkspaceTaskMock,
  releaseWorkspaceDueClaim: releaseWorkspaceDueClaimMock,
}));

vi.mock('@/lib/social/tiktok-publish-poll-worker', () => ({
  pollPendingTikTokPublishes: pollPendingTikTokPublishesMock,
}));

vi.mock('@/lib/oauth/token-refresh', () => ({
  processTokenRefresh: processTokenRefreshMock,
  cleanupExpiredOAuthStates: cleanupExpiredOAuthStatesMock,
}));

vi.mock('@/lib/firestore-pagination', () => ({
  getAllDocs: getAllDocsMock,
}));

vi.mock('@/lib/workers/workspace-tick', () => ({
  processWorkspaceTick: processWorkspaceTickMock,
  mapWithConcurrency: async <T, U>(
    items: T[],
    _concurrency: number,
    fn: (item: T) => Promise<U>,
  ) => {
    const results: PromiseSettledResult<U>[] = [];
    for (const item of items) {
      try {
        results.push({ status: 'fulfilled', value: await fn(item) });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }
    return results;
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  requestIdFromHeaders: () => 'test-request-id',
}));

function tickRequest(secret?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-worker-secret'] = secret;
  return new Request('http://localhost/api/worker/tick', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('POST /api/worker/tick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
    vi.stubEnv('WORKER_DUE_QUEUE_ENABLED', '0');
    processTokenRefreshMock.mockResolvedValue({
      refreshed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    });
    cleanupExpiredOAuthStatesMock.mockResolvedValue(0);
    getAllDocsMock.mockResolvedValue([{ id: 'ws_1' }]);
    processWorkspaceTickMock.mockResolvedValue({
      workspaceId: 'ws_1',
      durationMs: 10,
      publicPublishRuns: [],
      webhookDeliveries: [],
      jobsScanned: 0,
      jobsProcessed: 0,
      jobResults: [],
      errors: [],
    });
    acquireWorkerLeaseMock.mockResolvedValue('lease_1');
    releaseWorkerLeaseMock.mockResolvedValue(undefined);
    claimDueWorkspacesMock.mockResolvedValue([]);
    claimPeriodicWorkerPhaseMock.mockResolvedValue(false);
    cloudTasksDispatchEnabledMock.mockReturnValue(false);
    completeWorkspaceDueMock.mockResolvedValue(undefined);
    enqueueWorkspaceTaskMock.mockResolvedValue('task_1');
    releaseWorkspaceDueClaimMock.mockResolvedValue(undefined);
  });

  it('does not run the TikTok publish poller (owned by /api/worker/tiktok-poll)', async () => {
    const { POST } = await import('./route');
    const response = await POST(tickRequest('test-worker-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pollPendingTikTokPublishesMock).not.toHaveBeenCalled();
    expect(body.tiktokPublishes).toBeUndefined();
    expect(processWorkspaceTickMock).toHaveBeenCalledWith('ws_1');
    expect(releaseWorkerLeaseMock).toHaveBeenCalledWith('tick', 'lease_1');
  });

  it('claims only due workspaces between compatibility sweeps', async () => {
    vi.stubEnv('WORKER_DUE_QUEUE_ENABLED', '1');
    const dueClaim = {
      workspaceId: 'ws_due',
      version: 4,
      leaseId: 'due_lease',
      source: 'due' as const,
    };
    claimDueWorkspacesMock.mockResolvedValue([dueClaim]);
    claimPeriodicWorkerPhaseMock.mockImplementation(async (name: string) => name === 'global');
    processWorkspaceTickMock.mockResolvedValue({
      workspaceId: 'ws_due',
      durationMs: 10,
      publicPublishRuns: [],
      webhookDeliveries: [],
      jobsScanned: 0,
      jobsProcessed: 0,
      jobResults: [],
      errors: [],
    });

    const { POST } = await import('./route');
    const response = await POST(tickRequest('test-worker-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getAllDocsMock).not.toHaveBeenCalled();
    expect(processWorkspaceTickMock).toHaveBeenCalledWith('ws_due');
    expect(completeWorkspaceDueMock).toHaveBeenCalledWith(dueClaim);
    expect(body).toMatchObject({
      dueWorkspaces: 1,
      legacySweep: false,
      dispatched: 0,
      processedInProcess: 1,
    });
  });

  it('dispatches due work through Cloud Tasks when configured', async () => {
    vi.stubEnv('WORKER_DUE_QUEUE_ENABLED', '1');
    const dueClaim = {
      workspaceId: 'ws_due',
      version: 1,
      leaseId: 'due_lease',
      source: 'due' as const,
    };
    claimDueWorkspacesMock.mockResolvedValue([dueClaim]);
    claimPeriodicWorkerPhaseMock.mockResolvedValue(false);
    cloudTasksDispatchEnabledMock.mockReturnValue(true);

    const { POST } = await import('./route');
    const response = await POST(tickRequest('test-worker-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(enqueueWorkspaceTaskMock).toHaveBeenCalledWith(dueClaim);
    expect(processWorkspaceTickMock).not.toHaveBeenCalled();
    expect(completeWorkspaceDueMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ dispatched: 1, processedInProcess: 0 });
  });
});
