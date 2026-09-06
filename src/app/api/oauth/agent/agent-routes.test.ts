import { beforeEach, describe, expect, it, vi } from 'vitest';
// Hoisted with the mock factory: vi.mock runs before imports, so the fake
// has to exist before any module under test touches adminDb.
const db = await vi.hoisted(async () => {
  const { FakeFirestore } = await import('@/lib/agent-oauth/__tests__/fake-firestore');
  return new FakeFirestore();
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db }));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return { ...actual, applyRateLimit: vi.fn(async () => ({ headers: {} })) };
});
const ctx = { uid: 'user_1', email: 'admin@example.com', workspaceId: 'ws_1', role: 'admin', emailVerified: true };
vi.mock('@/lib/server-auth', () => ({ requireContext: vi.fn(async () => ctx) }));
vi.mock('@/lib/stripe/subscription', () => ({
  getEffectiveSubscription: vi.fn(async () => ({ status: 'active' })),
  isActiveSubscription: vi.fn(() => true),
}));

import { createOAuthClient, OAUTH_CODES } from '@/lib/agent-oauth/store';
import { randomToken, s256Challenge } from '@/lib/agent-oauth/pkce';

const ORIGIN = 'https://markaestro.com';
const RESOURCE = `${ORIGIN}/api/public/v1/mcp`;
const REDIRECT = 'https://chatgpt.com/connector/oauth/cb_123';

async function registerClient() {
  const { clientId } = await createOAuthClient({
    clientName: 'ChatGPT',
    redirectUris: [REDIRECT],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    clientUri: 'https://chatgpt.com',
  });
  return clientId;
}

async function consent(body: Record<string, unknown>, origin = ORIGIN) {
  const { POST } = await import('./consent/route');
  return POST(new Request(`${origin}/api/oauth/agent/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  }));
}

async function client(query: Record<string, string>) {
  const { GET } = await import('./client/route');
  const search = new URLSearchParams(query).toString();
  return GET(new Request(`${ORIGIN}/api/oauth/agent/client?${search}`, { headers: { authorization: 'Bearer test' } }));
}

function consentBody(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    redirectUri: REDIRECT,
    codeChallenge: s256Challenge(randomToken(48)),
    codeChallengeMethod: 'S256',
    state: 'st_1',
    productId: 'prod_1',
    scopes: ['products.read', 'posts.write'],
    ...overrides,
  };
}

describe('POST /api/oauth/agent/consent', () => {
  beforeEach(async () => {
    db.docs.clear();
    await db.doc('workspaces/ws_1/products/prod_1').set({ name: 'Northwind' });
  });

  it('issues a code and names the issuer (RFC 9207) on the redirect', async () => {
    const clientId = await registerClient();
    const res = await consent(consentBody(clientId));
    expect(res.status).toBe(200);
    const { redirectTo } = await res.json();
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('st_1');
    expect(url.searchParams.get('iss')).toBe(ORIGIN);
    const codes = db.under(`${OAUTH_CODES}/`);
    expect(codes).toHaveLength(1);
    expect(codes[0].data.resource).toBeNull();
  });

  it('binds the code to the resource the client asked for and derives iss from it', async () => {
    const clientId = await registerClient();
    // Consent served from the app host while the client discovered the API
    // on the apex: iss must be the apex, the origin the client recorded.
    vi.stubEnv('NEXT_PUBLIC_APP_ORIGIN', 'https://app.markaestro.com');
    vi.stubEnv('NEXT_PUBLIC_MARKETING_URL', 'https://markaestro.com');
    try {
      const res = await consent(consentBody(clientId, { resource: RESOURCE }), 'https://app.markaestro.com');
      expect(res.status).toBe(200);
      const url = new URL((await res.json()).redirectTo);
      expect(url.searchParams.get('iss')).toBe(ORIGIN);
      expect(db.under(`${OAUTH_CODES}/`)[0].data.resource).toBe(RESOURCE);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses a resource that is not this MCP server before minting anything', async () => {
    const clientId = await registerClient();
    const res = await consent(consentBody(clientId, { resource: 'https://evil.example/api/public/v1/mcp' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'OAUTH_INVALID_RESOURCE' });
    expect(db.under(`${OAUTH_CODES}/`)).toHaveLength(0);
  });

  it('mints an all-brands grant when the consent sets allBrands and omits the product', async () => {
    const clientId = await registerClient();
    const res = await consent(consentBody(clientId, { allBrands: true, productId: undefined }));
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).redirectTo);
    expect(url.searchParams.get('code')).toBeTruthy();
    const code = db.under(`${OAUTH_CODES}/`)[0];
    expect(code.data.allBrands).toBe(true);
    expect(code.data.productId).toBe('');
  });

  it('rejects a consent that sets both a brand and allBrands, or neither', async () => {
    const clientId = await registerClient();
    const both = await consent(consentBody(clientId, { allBrands: true }));
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: 'OAUTH_INVALID_BRAND_SCOPE' });
    const neither = await consent(consentBody(clientId, { allBrands: false, productId: undefined }));
    expect(neither.status).toBe(400);
    expect(await neither.json()).toMatchObject({ error: 'OAUTH_INVALID_BRAND_SCOPE' });
    expect(db.under(`${OAUTH_CODES}/`)).toHaveLength(0);
  });

  it('still refuses an unregistered redirect and an unknown client', async () => {
    const clientId = await registerClient();
    const mismatch = await consent(consentBody(clientId, { redirectUri: 'https://chatgpt.com/other' }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ error: 'OAUTH_REDIRECT_URI_MISMATCH' });
    const unknown = await consent(consentBody('oc_00000000-0000-0000-0000-000000000000'));
    expect(unknown.status).toBe(404);
  });
});

describe('GET /api/oauth/agent/client', () => {
  beforeEach(() => db.docs.clear());

  it('describes the client and echoes the normalized resource', async () => {
    const clientId = await registerClient();
    const res = await client({ client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client).toMatchObject({ id: clientId, name: 'ChatGPT' });
    expect(body.resource).toBe(RESOURCE);
    expect(body.scopes.length).toBeGreaterThan(0);
  });

  it('reports a bad resource only after the redirect URI checked out, so the page can bounce the client', async () => {
    const clientId = await registerClient();
    const badResource = await client({ client_id: clientId, redirect_uri: REDIRECT, resource: 'https://evil.example/api/public/v1/mcp' });
    expect(badResource.status).toBe(400);
    expect(await badResource.json()).toMatchObject({ error: 'OAUTH_INVALID_RESOURCE' });

    const badRedirect = await client({ client_id: clientId, redirect_uri: 'https://evil.example/cb', resource: 'https://evil.example/api/public/v1/mcp' });
    expect(badRedirect.status).toBe(400);
    expect(await badRedirect.json()).toMatchObject({ error: 'OAUTH_REDIRECT_URI_MISMATCH' });
  });
});
