import { beforeEach, describe, expect, it, vi } from 'vitest';

// The all-brands branch of evergreen create: a sitewide key must name the
// target brand per request and it must belong to the workspace; a brand-bound
// key keeps its old behaviour. adminDb is faked so the product-existence check
// is deterministic, and the storage + idempotency layers are stubbed.
const db = await vi.hoisted(async () => {
  const { FakeFirestore } = await import('@/lib/agent-oauth/__tests__/fake-firestore');
  return new FakeFirestore();
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db }));

const ctxRef: { value: Record<string, unknown> } = { value: {} };
vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: vi.fn(async () => ctxRef.value),
}));

const createEvergreenQueue = vi.fn(async (..._args: unknown[]) => ({ id: "eq_1" }));
vi.mock('@/lib/evergreen/storage', () => ({
  createEvergreenQueue: (...args: unknown[]) => createEvergreenQueue(...(args as [])),
  listEvergreenQueues: vi.fn(async () => []),
}));
vi.mock('@/lib/public-api/idempotency', () => ({
  getIdempotencyKey: () => null,
  createRequestHash: () => 'h',
  loadIdempotentResponse: async () => null,
  persistIdempotentResponse: async () => {},
}));

function ctx(overrides: Record<string, unknown>) {
  return {
    workspaceId: 'ws_1', clientId: 'cli_1', ownerUid: 'u1', mode: 'live',
    scopes: ['evergreen.write'], rateLimitHeaders: {}, planTier: 'starter', apiVersion: 'v1',
    productId: null, allBrands: false, ...overrides,
  };
}
async function post(body: unknown) {
  const { POST } = await import('./route');
  return POST(new Request('https://markaestro.com/api/public/v1/evergreen-queues', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}
const validBody = (productId?: string) => ({
  ...(productId ? { productId } : {}), sourcePostId: 'pst_1', name: 'Weekly', contentConfirmed: true,
  variants: [{ caption: 'Still true next month.' }],
});

describe('POST /api/public/v1/evergreen-queues brand scope', () => {
  beforeEach(async () => {
    db.docs.clear();
    createEvergreenQueue.mockClear();
    await db.doc('workspaces/ws_1/products/prod_2').set({ name: 'Second brand' });
  });

  it('all-brands key: creates a queue for the requested brand when it exists', async () => {
    ctxRef.value = ctx({ productId: null, allBrands: true });
    const res = await post(validBody('prod_2'));
    expect(res.status).toBe(201);
    expect(createEvergreenQueue).toHaveBeenCalledTimes(1);
    // The queue was created for the brand named in the request.
    const input = createEvergreenQueue.mock.calls[0][2] as unknown as { productId: string };
    expect(input.productId).toBe('prod_2');
  });

  it('all-brands key: requires a brand in the request', async () => {
    ctxRef.value = ctx({ productId: null, allBrands: true });
    const res = await post(validBody());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'VALIDATION_PRODUCT_REQUIRED' });
    expect(createEvergreenQueue).not.toHaveBeenCalled();
  });

  it('all-brands key: refuses a brand outside the workspace', async () => {
    ctxRef.value = ctx({ productId: null, allBrands: true });
    const res = await post(validBody('prod_not_here'));
    expect(res.status).toBe(404);
    expect(createEvergreenQueue).not.toHaveBeenCalled();
  });

  it('brand-bound key: refuses a request naming a different brand', async () => {
    ctxRef.value = ctx({ productId: 'prod_1', allBrands: false });
    const res = await post(validBody('prod_2'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'VALIDATION_PRODUCT_SCOPE_MISMATCH' });
    expect(createEvergreenQueue).not.toHaveBeenCalled();
  });

  it('brand-bound key: uses its own brand when the request omits one', async () => {
    ctxRef.value = ctx({ productId: 'prod_1', allBrands: false });
    const res = await post(validBody());
    expect(res.status).toBe(201);
    const input = createEvergreenQueue.mock.calls[0][2] as unknown as { productId: string };
    expect(input.productId).toBe('prod_1');
  });
});
