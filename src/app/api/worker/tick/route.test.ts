import { beforeEach, describe, expect, it, vi } from 'vitest';

const pollPendingTikTokPublishesMock = vi.fn();
const processTokenRefreshMock = vi.fn();
const cleanupExpiredOAuthStatesMock = vi.fn();
const getAllDocsMock = vi.fn();
const processWorkspaceTickMock = vi.fn();

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
  });

  it('does not run the TikTok publish poller (owned by /api/worker/tiktok-poll)', async () => {
    const { POST } = await import('./route');
    const response = await POST(tickRequest('test-worker-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pollPendingTikTokPublishesMock).not.toHaveBeenCalled();
    expect(body.tiktokPublishes).toBeUndefined();
    expect(processWorkspaceTickMock).toHaveBeenCalledWith('ws_1');
  });
});
