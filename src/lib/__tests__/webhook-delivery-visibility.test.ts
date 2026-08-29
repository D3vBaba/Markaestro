import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `webhook_deliveries` recorded attempts, response codes, retry state, and
 * `lastError` from the day webhooks shipped, and exposed none of it. A
 * customer whose endpoint had been 500-ing for a week had no way to find that
 * out, and neither did we without a Firestore console.
 */

const docMock = vi.fn();
const collectionMock = vi.fn();
const executeListQueryPageMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: collectionMock, doc: docMock, runTransaction: vi.fn() },
}));

vi.mock('@/lib/firestore-list-query', () => ({
  executeListQueryPage: executeListQueryPageMock,
}));

vi.mock('@/lib/public-api/keys', () => ({
  buildWebhookSecret: () => ({ secret: 's', secretHash: 'h', secretEncrypted: 'e' }),
}));

vi.mock('@/lib/workers/due-workspaces', () => ({ markWorkspaceDue: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

/** A `where(...).orderBy(...).limit(...).get()` chain resolving to `docs`. */
function deliveryQuery(docs: Array<{ data: () => Record<string, unknown> }>) {
  return {
    where: () => ({
      orderBy: () => ({
        limit: () => ({ get: async () => ({ docs }) }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listWebhookDeliveries', () => {
  it('refuses to list deliveries for an endpoint that does not exist', async () => {
    docMock.mockReturnValue({ get: async () => ({ exists: false }) });
    const { listWebhookDeliveries } = await import('@/lib/public-api/webhooks');

    await expect(listWebhookDeliveries('ws1', 'missing')).rejects.toThrow('NOT_FOUND');
  });

  it('returns the attempt, response code, and retry state per delivery', async () => {
    docMock.mockReturnValue({ get: async () => ({ exists: true }) });
    collectionMock.mockReturnValue({});
    executeListQueryPageMock.mockResolvedValue({
      items: [{
        id: 'del_1',
        eventType: 'post.published',
        status: 'failed',
        attemptCount: 5,
        responseCode: 500,
        lastError: 'Webhook responded 500',
        createdAt: '2026-08-01T00:00:00.000Z',
        lastAttemptAt: '2026-08-01T01:00:00.000Z',
        nextAttemptAt: null,
      }],
      nextCursor: 'cursor-2',
    });
    const { listWebhookDeliveries } = await import('@/lib/public-api/webhooks');

    const page = await listWebhookDeliveries('ws1', 'wh_1');
    expect(page.deliveries[0]).toEqual({
      id: 'del_1',
      eventType: 'post.published',
      status: 'failed',
      attemptCount: 5,
      responseCode: 500,
      lastError: 'Webhook responded 500',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastAttemptAt: '2026-08-01T01:00:00.000Z',
      nextAttemptAt: null,
    });
    expect(page.nextCursor).toBe('cursor-2');
  });

  it('truncates lastError so a provider HTML page cannot be echoed back', async () => {
    docMock.mockReturnValue({ get: async () => ({ exists: true }) });
    collectionMock.mockReturnValue({});
    executeListQueryPageMock.mockResolvedValue({
      items: [{ id: 'del_1', status: 'failed', lastError: 'x'.repeat(5000) }],
      nextCursor: null,
    });
    const { listWebhookDeliveries } = await import('@/lib/public-api/webhooks');

    const page = await listWebhookDeliveries('ws1', 'wh_1');
    expect(page.deliveries[0].lastError.length).toBeLessThanOrEqual(301);
  });

  it('never returns the delivered payload', async () => {
    docMock.mockReturnValue({ get: async () => ({ exists: true }) });
    collectionMock.mockReturnValue({});
    executeListQueryPageMock.mockResolvedValue({
      items: [{ id: 'del_1', status: 'delivered', payload: { data: { secret: 'nope' } } }],
      nextCursor: null,
    });
    const { listWebhookDeliveries } = await import('@/lib/public-api/webhooks');

    const page = await listWebhookDeliveries('ws1', 'wh_1');
    expect(JSON.stringify(page.deliveries[0])).not.toContain('nope');
  });

  it('clamps an absurd limit rather than passing it through', async () => {
    docMock.mockReturnValue({ get: async () => ({ exists: true }) });
    collectionMock.mockReturnValue({});
    executeListQueryPageMock.mockResolvedValue({ items: [], nextCursor: null });
    const { listWebhookDeliveries } = await import('@/lib/public-api/webhooks');

    await listWebhookDeliveries('ws1', 'wh_1', { limit: 10_000 });
    expect(executeListQueryPageMock.mock.calls[0][1].limit).toBe(100);
  });
});

describe('summarizeWebhookEndpointHealth', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');

  it('counts delivered and failed inside the 24-hour window only', async () => {
    collectionMock.mockReturnValue(deliveryQuery([
      { data: () => ({ status: 'delivered', lastAttemptAt: '2026-08-29T11:00:00.000Z' }) },
      { data: () => ({ status: 'failed', lastAttemptAt: '2026-08-29T10:00:00.000Z' }) },
      // Three days ago: still informs lastSuccessAt, but not the 24h count.
      { data: () => ({ status: 'delivered', lastAttemptAt: '2026-08-26T10:00:00.000Z' }) },
    ]));
    const { summarizeWebhookEndpointHealth } = await import('@/lib/public-api/webhooks');

    const health = await summarizeWebhookEndpointHealth('ws1', ['wh_1'], now);
    expect(health.wh_1.delivered24h).toBe(1);
    expect(health.wh_1.failed24h).toBe(1);
    expect(health.wh_1.lastSuccessAt).toBe('2026-08-29T11:00:00.000Z');
    expect(health.wh_1.lastFailureAt).toBe('2026-08-29T10:00:00.000Z');
  });

  it('counts deliveries still in flight separately from outcomes', async () => {
    collectionMock.mockReturnValue(deliveryQuery([
      { data: () => ({ status: 'pending', createdAt: '2026-08-29T11:59:00.000Z' }) },
      { data: () => ({ status: 'retrying', createdAt: '2026-08-29T11:58:00.000Z' }) },
    ]));
    const { summarizeWebhookEndpointHealth } = await import('@/lib/public-api/webhooks');

    const health = await summarizeWebhookEndpointHealth('ws1', ['wh_1'], now);
    expect(health.wh_1.pending).toBe(2);
    expect(health.wh_1.delivered24h).toBe(0);
    expect(health.wh_1.failed24h).toBe(0);
  });

  it('returns zeroes rather than failing the settings page when the query throws', async () => {
    collectionMock.mockReturnValue({
      where: () => ({
        orderBy: () => ({
          limit: () => ({ get: async () => { throw new Error('index building'); } }),
        }),
      }),
    });
    const { summarizeWebhookEndpointHealth } = await import('@/lib/public-api/webhooks');

    const health = await summarizeWebhookEndpointHealth('ws1', ['wh_1'], now);
    expect(health.wh_1).toEqual({
      endpointId: 'wh_1',
      delivered24h: 0,
      failed24h: 0,
      pending: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    });
  });
});
