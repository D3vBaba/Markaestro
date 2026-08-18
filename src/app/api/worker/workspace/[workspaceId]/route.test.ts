import { beforeEach, describe, expect, it, vi } from 'vitest';

const processWorkspaceTickMock = vi.fn();
const acquireWorkerLeaseMock = vi.fn();
const releaseWorkerLeaseMock = vi.fn();
const completeWorkspaceDueMock = vi.fn();
const releaseWorkspaceDueClaimMock = vi.fn();

vi.mock('@/lib/workers/workspace-tick', () => ({
  processWorkspaceTick: processWorkspaceTickMock,
}));

vi.mock('@/lib/workers/lease', () => ({
  acquireWorkerLease: acquireWorkerLeaseMock,
  releaseWorkerLease: releaseWorkerLeaseMock,
}));

vi.mock('@/lib/workers/due-workspaces', () => ({
  completeWorkspaceDue: completeWorkspaceDueMock,
  releaseWorkspaceDueClaim: releaseWorkspaceDueClaimMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn() },
  requestIdFromHeaders: () => 'test-request-id',
}));

const dueClaim = {
  workspaceId: 'ws_1',
  version: 3,
  leaseId: 'due_lease',
  source: 'due' as const,
};

function request(body: unknown = dueClaim) {
  return new Request('http://localhost/api/worker/workspace/ws_1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': 'test-worker-secret',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/worker/workspace/[workspaceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
    acquireWorkerLeaseMock.mockResolvedValue('workspace_lease');
    releaseWorkerLeaseMock.mockResolvedValue(undefined);
    completeWorkspaceDueMock.mockResolvedValue(undefined);
    releaseWorkspaceDueClaimMock.mockResolvedValue(undefined);
    processWorkspaceTickMock.mockResolvedValue({
      workspaceId: 'ws_1',
      durationMs: 5,
      publicPublishRuns: [],
      webhookDeliveries: [],
      jobsScanned: 0,
      jobsProcessed: 0,
      jobResults: [],
      errors: [],
    });
  });

  it('completes the due claim and always releases the workspace lease', async () => {
    const { POST } = await import('./route');
    const response = await POST(request(), { params: Promise.resolve({ workspaceId: 'ws_1' }) });

    expect(response.status).toBe(200);
    expect(processWorkspaceTickMock).toHaveBeenCalledWith('ws_1');
    expect(completeWorkspaceDueMock).toHaveBeenCalledWith(dueClaim);
    expect(releaseWorkerLeaseMock).toHaveBeenCalledWith('workspace-ws_1', 'workspace_lease');
    expect(releaseWorkspaceDueClaimMock).not.toHaveBeenCalled();
  });

  it('releases a due claim for retry when workspace processing fails', async () => {
    processWorkspaceTickMock.mockRejectedValue(new Error('worker failed'));
    const { POST } = await import('./route');
    const response = await POST(request(), { params: Promise.resolve({ workspaceId: 'ws_1' }) });

    expect(response.status).toBe(500);
    expect(releaseWorkspaceDueClaimMock).toHaveBeenCalledWith(dueClaim);
    expect(releaseWorkerLeaseMock).toHaveBeenCalledWith('workspace-ws_1', 'workspace_lease');
  });
});
