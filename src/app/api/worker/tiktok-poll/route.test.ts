import { beforeEach, describe, expect, it, vi } from 'vitest';

const pollPendingTikTokPublishesMock = vi.fn();

vi.mock('@/lib/social/tiktok-publish-poll-worker', () => ({
  pollPendingTikTokPublishes: pollPendingTikTokPublishesMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  requestIdFromHeaders: () => 'test-request-id',
}));

function pollRequest(secret?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-worker-secret'] = secret;
  return new Request('http://localhost/api/worker/tiktok-poll', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('POST /api/worker/tiktok-poll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
    pollPendingTikTokPublishesMock.mockResolvedValue({
      polled: 2,
      completed: 1,
      failed: 0,
      pending: 1,
      errors: [],
    });
  });

  it('rejects missing worker secret', async () => {
    const { POST } = await import('./route');
    const response = await POST(pollRequest());
    expect(response.status).toBe(401);
    expect(pollPendingTikTokPublishesMock).not.toHaveBeenCalled();
  });

  it('polls pending TikTok publishes once per invocation', async () => {
    const { POST } = await import('./route');
    const started = Date.now();
    const response = await POST(pollRequest('test-worker-secret'));
    const elapsed = Date.now() - started;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pollPendingTikTokPublishesMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(1_000);
    expect(body.iterations).toEqual([
      { polled: 2, completed: 1, failed: 0, pending: 1, errors: 0 },
    ]);
  });
});
