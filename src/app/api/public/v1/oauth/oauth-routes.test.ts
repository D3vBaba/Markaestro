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

import { createAuthorizationCode } from '@/lib/agent-oauth/store';
import { randomToken, s256Challenge } from '@/lib/agent-oauth/pkce';
import { parseApiKey } from '@/lib/public-api/keys';

const ORIGIN = 'https://markaestro.com';

async function register(body: unknown) {
  const { POST } = await import('./register/route');
  return POST(new Request(`${ORIGIN}/api/public/v1/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function token(form: Record<string, string>) {
  const { POST } = await import('./token/route');
  return POST(new Request(`${ORIGIN}/api/public/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }));
}

async function revoke(form: Record<string, string>) {
  const { POST } = await import('./revoke/route');
  return POST(new Request(`${ORIGIN}/api/public/v1/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }));
}

describe('POST /api/public/v1/oauth/register', () => {
  beforeEach(() => db.docs.clear());

  it('registers a public client the way the MCP SDK does', async () => {
    const res = await register({
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost:51234/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.client_id).toMatch(/^oc_/);
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual(['http://localhost:51234/callback']);
    expect(typeof body.client_id_issued_at).toBe('number');
  });

  it('issues a secret when the client asks for secret-based auth', async () => {
    const res = await register({
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.client_secret).toBe('string');
    expect(body.client_secret_expires_at).toBe(0);
  });

  it('rejects plain-http redirects to a real host with an RFC 7591 error', async () => {
    const res = await register({ redirect_uris: ['http://example.com/callback'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(db.docs.size).toBe(0);
  });

  it('rejects a body without redirect_uris', async () => {
    const res = await register({ client_name: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('rejects unsupported grant types', async () => {
    const res = await register({ redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });
});

describe('POST /api/public/v1/oauth/token', () => {
  beforeEach(() => db.docs.clear());

  async function connectedClient() {
    const res = await register({ client_name: 'Claude Code', redirect_uris: ['http://localhost:1/cb'] });
    const { client_id: clientId } = await res.json();
    const verifier = randomToken(48);
    const code = await createAuthorizationCode({
      clientId,
      redirectUri: 'http://localhost:1/cb',
      codeChallenge: s256Challenge(verifier),
      scopes: ['products.read', 'posts.write'],
      workspaceId: 'ws_1',
      productId: 'prod_1',
      uid: 'user_1',
      clientName: 'Claude Code',
    });
    return { clientId, verifier, code };
  }

  it('exchanges a code for an API key over form encoding, with no-store caching', async () => {
    const { clientId, verifier, code } = await connectedClient();
    const res = await token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      // The loopback port differs from registration, as it will at runtime.
      redirect_uri: 'http://localhost:60000/cb',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.token_type).toBe('Bearer');
    expect(parseApiKey(body.access_token)?.workspaceId).toBe('ws_1');
    expect(body.refresh_token).toBeTruthy();
    expect(body.scope).toBe('products.read posts.write');
  });

  it('then refreshes that token', async () => {
    const { clientId, verifier, code } = await connectedClient();
    const first = await (await token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier })).json();
    const res = await token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).not.toBe(first.access_token);
    expect(parseApiKey(body.access_token)?.clientId).toBe(parseApiKey(first.access_token)?.clientId);
  });

  it('answers OAuth error shapes for bad grants', async () => {
    const missing = await token({ client_id: 'oc_x' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });

    const unsupported = await token({ grant_type: 'password', client_id: 'oc_x' });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: 'unsupported_grant_type' });

    const unknownClient = await token({
      grant_type: 'authorization_code',
      client_id: 'oc_00000000-0000-0000-0000-000000000000',
      code: randomToken(),
      code_verifier: randomToken(48),
    });
    expect(unknownClient.status).toBe(401);
    expect(await unknownClient.json()).toMatchObject({ error: 'invalid_client' });

    const { clientId, code } = await connectedClient();
    const badVerifier = await token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: randomToken(48),
    });
    expect(badVerifier.status).toBe(400);
    expect(await badVerifier.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('POST /api/public/v1/oauth/revoke', () => {
  beforeEach(() => db.docs.clear());

  it('revokes the connected key and answers 200 for unknown tokens too', async () => {
    const res = await register({ redirect_uris: ['http://localhost:1/cb'] });
    const { client_id: clientId } = await res.json();
    const verifier = randomToken(48);
    const code = await createAuthorizationCode({
      clientId,
      redirectUri: 'http://localhost:1/cb',
      codeChallenge: s256Challenge(verifier),
      scopes: ['products.read'],
      workspaceId: 'ws_1',
      productId: 'prod_1',
      uid: 'user_1',
      clientName: 'x',
    });
    const tokens = await (await token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier })).json();
    const { clientId: apiClientId } = parseApiKey(tokens.access_token)!;

    expect((await revoke({ token: tokens.access_token })).status).toBe(200);
    expect(db.docs.get(`workspaces/ws_1/api_clients/${apiClientId}`)?.status).toBe('revoked');
    expect((await revoke({ token: 'nothing' })).status).toBe(200);
    expect((await revoke({})).status).toBe(400);
  });
});
