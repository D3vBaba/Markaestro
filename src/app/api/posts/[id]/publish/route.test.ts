import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, createFirestoreStub, mockContext } from '@/test/route-harness';

/**
 * The most expensive request a signed-in user can send: maxDuration 300,
 * outbound platform calls, media uploads, and an inline TikTok poll. It ran
 * unmetered while the public API's enqueue-only equivalent was limited to
 * 20/min (4.2).
 *
 * The ordering these tests pin is the part that silently regresses: the
 * per-channel hourly check must run BEFORE the claim, because the claim moves
 * the post into `publishing` and clears `scheduledAt`, so a post-claim 429
 * would strand the post until its lease expired.
 */

const db = createFirestoreStub();
const requireContextMock = vi.fn();
const applyRateLimitMock = vi.fn();
const checkRateLimitMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
vi.mock('@/lib/server-auth', () => ({ requireContext: () => requireContextMock() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: {
    publish: { limit: 10, windowMs: 60_000 },
    publishPerAccount: { limit: 30, windowMs: 3_600_000 },
  },
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));
vi.mock('@/lib/social/publisher', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/social/publisher');
  return {
    ...actual,
    claimPostForImmediatePublish: (...args: unknown[]) => claimMock(...args),
  };
});
vi.mock('@/lib/social/publish-run-records', () => ({
  startPublishRun: async () => 'run_1',
  finishPublishRun: async () => undefined,
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

const POST_PATH = 'workspaces/ws_1/posts/post_1';

beforeEach(() => {
  vi.clearAllMocks();
  db.reset({
    [POST_PATH]: {
      status: 'draft',
      channel: 'linkedin',
      targetChannels: ['linkedin'],
      content: 'hello',
      mediaUrls: [],
    },
  });
  requireContextMock.mockResolvedValue(mockContext());
  applyRateLimitMock.mockResolvedValue({ headers: {} });
  checkRateLimitMock.mockResolvedValue({ allowed: true, resetAt: Date.now() + 1000 });
  claimMock.mockResolvedValue({ ok: false, status: 409, error: 'stop-here' });
});

async function post() {
  const { POST } = await import('./route');
  return callRoute(POST, { method: 'POST', params: { id: 'post_1' } });
}

describe('POST /api/posts/[id]/publish rate limiting', () => {
  it('applies the workspace-keyed publish tier before anything else', async () => {
    await post();
    expect(applyRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 10, windowMs: 60_000 },
      { key: 'publish:ws_1' },
    );
  });

  it('refuses on the per-channel hourly ceiling BEFORE claiming the post', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, resetAt: Date.now() + 90_000 });

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED_CHANNEL');
    expect(res.body.channel).toBe('linkedin');
    expect(typeof res.body.retryAfterSeconds).toBe('number');
    // The invariant: a 429 must not strand the post in `publishing`.
    expect(claimMock).not.toHaveBeenCalled();
    expect(db.get(POST_PATH)!.status).toBe('draft');
  });

  it('exempts manual-reminder channels from the per-channel ceiling', async () => {
    db.set(POST_PATH, {
      status: 'draft',
      channel: 'instagram',
      targetChannels: ['instagram'],
      channelDeliveryModes: { instagram: 'manual_reminder' },
      content: 'hello',
      mediaUrls: ['https://example.com/a.jpg'],
    });

    await post();

    // Manual channels never call a platform API, so metering them against a
    // platform-abuse ceiling would refuse posts that touch no platform.
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(claimMock).toHaveBeenCalled();
  });

  it('blocks unverified emails before any limiter or claim', async () => {
    requireContextMock.mockResolvedValue(mockContext({ emailVerified: false }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(claimMock).not.toHaveBeenCalled();
  });
});
