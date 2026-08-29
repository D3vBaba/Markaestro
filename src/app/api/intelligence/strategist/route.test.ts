import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, createFirestoreStub, mockContext } from '@/test/route-harness';

/**
 * `/api/intelligence/strategist` charged a strategist turn and then called the
 * model synchronously. A Vertex 503 returned an error and the turn was gone:
 * the customer paid for an answer they never got, out of a monthly allowance.
 *
 * It also skipped `applyRateLimit` entirely, like the other four Vertex-backed
 * routes. The monthly quota bounds total spend but not rate, so a retry loop
 * could exhaust a customer's whole month in seconds, and this handler holds a
 * Cloud Run worker open for the full model call, so a burst costs concurrency
 * as well as money.
 *
 * The two invariants: a rate-limited request costs no quota, and a failed
 * model call refunds the turn.
 */

const db = createFirestoreStub();
const requireContextMock = vi.fn();
const applyRateLimitMock = vi.fn();
const requireIntelligenceAccessMock = vi.fn();
const askStrategistMock = vi.fn();
const withAiOperationMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
vi.mock('@/lib/server-auth', () => ({ requireContext: () => requireContextMock() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { strategist: { limit: 5, windowMs: 60_000 }, ai: { limit: 10, windowMs: 60_000 } },
  applyRateLimit: (...args: unknown[]) => applyRateLimitMock(...args),
}));
vi.mock('@/lib/intelligence/access', () => ({
  requireIntelligenceAccess: (...args: unknown[]) => requireIntelligenceAccessMock(...args),
}));
vi.mock('@/lib/intelligence/strategist', () => ({
  askStrategist: (...args: unknown[]) => askStrategistMock(...args),
}));
vi.mock('@/lib/stripe/entitlements', () => ({
  getEffectiveLimits: async () => ({ strategistTurnsPerMonth: 50 }),
}));
vi.mock('@/lib/intelligence/usage', () => ({
  withAiOperation: (...args: unknown[]) => withAiOperationMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.reset({ 'workspaces/ws_1/products/prod_1': { name: 'Acme' } });
  requireContextMock.mockResolvedValue(mockContext());
  applyRateLimitMock.mockResolvedValue({ headers: {} });
  requireIntelligenceAccessMock.mockResolvedValue(undefined);
  askStrategistMock.mockResolvedValue({ answer: 'Post on Tuesdays.', citations: [] });
  // Faithful to the real wrapper: charge, run, refund on throw.
  withAiOperationMock.mockImplementation(async (_input: unknown, run: () => Promise<unknown>) => run());
});

async function post(body: unknown = { productId: 'prod_1', question: 'When should I post?' }) {
  const { POST } = await import('./route');
  return callRoute(POST, { method: 'POST', body });
}

describe('POST /api/intelligence/strategist', () => {
  it('answers and records the conversation', async () => {
    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('Post on Tuesdays.');
    const written = db.writes.find((write) => write.path.includes('strategistConversations'));
    expect(written?.data).toMatchObject({ productId: 'prod_1', question: 'When should I post?' });
  });

  it('rate limits before charging anything', async () => {
    // The ordering is the point: a rate-limited request must cost the customer
    // no part of their monthly allowance.
    applyRateLimitMock.mockRejectedValue(new Error('RATE_LIMITED'));

    await post();

    expect(withAiOperationMock).not.toHaveBeenCalled();
    expect(askStrategistMock).not.toHaveBeenCalled();
  });

  it('uses the tighter strategist tier, not the shared ai tier', async () => {
    // This handler holds a worker open for the whole model call, so its
    // ceiling is lower than the other AI routes on purpose.
    await post();
    const [, config, options] = applyRateLimitMock.mock.calls[0];
    expect(config).toEqual({ limit: 5, windowMs: 60_000 });
    expect(options).toEqual({ key: 'strategist:user_1' });
  });

  it('runs the model call inside the charge-and-refund wrapper', async () => {
    await post();

    expect(withAiOperationMock).toHaveBeenCalledOnce();
    const [input] = withAiOperationMock.mock.calls[0];
    expect(input).toMatchObject({
      workspaceId: 'ws_1',
      uid: 'user_1',
      kind: 'strategist',
      monthlyLimit: 50,
    });
  });

  it('does not record a conversation when the model call fails', async () => {
    // The wrapper gives the turn back; this asserts nothing half-written is
    // left behind to look like an answer.
    withAiOperationMock.mockRejectedValue(new Error('VERTEX_UNAVAILABLE'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(db.writes.filter((write) => write.path.includes('strategistConversations'))).toEqual([]);
  });

  it('checks intelligence access before spending a turn', async () => {
    requireIntelligenceAccessMock.mockRejectedValue(new Error('FEATURE_NOT_AVAILABLE'));

    const res = await post();

    expect(res.status).toBe(404);
    expect(withAiOperationMock).not.toHaveBeenCalled();
  });

  it('404s an unknown brand rather than charging for a question about nothing', async () => {
    const res = await post({ productId: 'missing', question: 'When should I post?' });

    expect(res.status).toBe(404);
    expect(withAiOperationMock).not.toHaveBeenCalled();
  });

  it('rejects an empty question', async () => {
    const res = await post({ productId: 'prod_1', question: '' });
    expect(res.status).toBe(400);
    expect(withAiOperationMock).not.toHaveBeenCalled();
  });
});
