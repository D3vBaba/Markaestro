import { beforeEach, describe, expect, it, vi } from 'vitest';
// Hoisted with the mock factory: vi.mock runs before imports, so the fake
// has to exist before any module under test touches adminDb.
const db = await vi.hoisted(async () => {
  const { FakeFirestore } = await import('./fake-firestore');
  return new FakeFirestore();
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db }));

import { exchangeAuthorizationCode, refreshAccessToken } from '../grants';
import { OAuthError } from '../errors';
import { randomToken, s256Challenge } from '../pkce';
import {
  OAUTH_CLIENTS,
  createAuthorizationCode,
  createOAuthClient,
  getOAuthClient,
  isOAuthClientId,
  touchOAuthClient,
} from '../store';

const ORIGIN = 'https://markaestro.com';
const RESOURCE = `${ORIGIN}/api/public/v1/mcp`;
const REDIRECT = 'https://chatgpt.com/connector/oauth/cb_123';

function tokenReq() {
  return new Request(`${ORIGIN}/api/public/v1/oauth/token`, { method: 'POST' });
}

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

async function consent(clientId: string, verifier: string, resource: string | null) {
  return createAuthorizationCode({
    clientId,
    redirectUri: REDIRECT,
    codeChallenge: s256Challenge(verifier),
    scopes: ['products.read', 'posts.write'],
    workspaceId: 'ws_1',
    productId: 'prod_1',
    uid: 'user_1',
    clientName: 'ChatGPT',
    resource,
  });
}

async function expectOAuthError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(OAuthError);
  await promise.catch((error: OAuthError) => expect(error.code).toBe(code));
}

describe('RFC 8707 resource on the token endpoint', () => {
  beforeEach(() => db.docs.clear());

  it('redeems a code when the token request names the same resource', async () => {
    const clientId = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier, RESOURCE);
    const tokens = await exchangeAuthorizationCode(tokenReq(), {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(tokens.access_token).toMatch(/^mk_live_/);
  });

  it('refuses a code redeemed for another resource, and consumes it', async () => {
    const clientId = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier, RESOURCE);
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        resource: 'https://evil.example/api/public/v1/mcp',
      }),
      'invalid_target',
    );
    // Single use: the failed attempt burned the code, so it cannot be retried
    // with the right resource by whoever intercepted it.
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
      'invalid_grant',
    );
  });

  it('refuses a resource that is this host but not the MCP endpoint', async () => {
    const clientId = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier, RESOURCE);
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        resource: `${ORIGIN}/api/public/v1/posts`,
      }),
      'invalid_target',
    );
  });

  it('lets clients that never send a resource keep working, even for a code that carried one', async () => {
    const clientId = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier, RESOURCE);
    const tokens = await exchangeAuthorizationCode(tokenReq(), {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
    });
    expect(tokens.token_type).toBe('Bearer');
  });

  it('checks the resource on refresh too', async () => {
    const clientId = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier, null);
    const first = await exchangeAuthorizationCode(tokenReq(), {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
    });
    await expectOAuthError(
      refreshAccessToken(tokenReq(), {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: first.refresh_token,
        resource: 'https://evil.example/api/public/v1/mcp',
      }),
      'invalid_target',
    );
  });
});

describe('first-party OAuth clients', () => {
  beforeEach(() => db.docs.clear());

  const FIRST_PARTY_ID = 'markaestro-grok-web';

  async function seedFirstParty() {
    await db.collection(OAUTH_CLIENTS).doc(FIRST_PARTY_ID).set({
      clientName: 'Grok',
      redirectUris: ['https://grok.com/oauth/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      secretHash: null,
      clientUri: 'https://grok.com',
      createdAt: '2026-09-05T00:00:00.000Z',
      lastUsedAt: null,
      firstParty: true,
    });
  }

  it('recognises both id shapes and nothing else', () => {
    expect(isOAuthClientId('oc_00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isOAuthClientId(FIRST_PARTY_ID)).toBe(true);
    expect(isOAuthClientId('markaestro-')).toBe(false);
    expect(isOAuthClientId('Markaestro-Grok')).toBe(false);
    expect(isOAuthClientId('../oauth_codes/x')).toBe(false);
    expect(isOAuthClientId('')).toBe(false);
  });

  it('resolves a seeded client that has no expiry', async () => {
    await seedFirstParty();
    const client = await getOAuthClient(FIRST_PARTY_ID);
    expect(client?.clientName).toBe('Grok');
    expect(client?.firstParty).toBe(true);
  });

  it('treats a registered client without an expiry as expired, not immortal', async () => {
    await db.collection(OAUTH_CLIENTS).doc('oc_00000000-0000-0000-0000-000000000001').set({
      clientName: 'broken',
      redirectUris: ['http://localhost:1/cb'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      secretHash: null,
      clientUri: null,
      createdAt: '2026-09-05T00:00:00.000Z',
      lastUsedAt: null,
    });
    expect(await getOAuthClient('oc_00000000-0000-0000-0000-000000000001')).toBeNull();
  });

  it('never writes an expiry onto a first-party client when it is used', async () => {
    await seedFirstParty();
    const verifier = randomToken(48);
    const code = await createAuthorizationCode({
      clientId: FIRST_PARTY_ID,
      redirectUri: 'https://grok.com/oauth/callback',
      codeChallenge: s256Challenge(verifier),
      scopes: ['products.read'],
      workspaceId: 'ws_1',
      productId: 'prod_1',
      uid: 'user_1',
      clientName: 'Grok',
      resource: RESOURCE,
    });
    const tokens = await exchangeAuthorizationCode(tokenReq(), {
      grant_type: 'authorization_code',
      client_id: FIRST_PARTY_ID,
      code,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    expect(tokens.access_token).toMatch(/^mk_live_/);
    const stored = db.docs.get(`${OAUTH_CLIENTS}/${FIRST_PARTY_ID}`)!;
    expect(stored.lastUsedAt).toBeTruthy();
    expect(stored).not.toHaveProperty('expiresAt');

    // And the plain touch path behaves the same, while a registered client
    // still has its expiry pushed out.
    await touchOAuthClient(FIRST_PARTY_ID, { firstParty: true });
    expect(db.docs.get(`${OAUTH_CLIENTS}/${FIRST_PARTY_ID}`)).not.toHaveProperty('expiresAt');
    const { clientId } = await createOAuthClient({
      clientName: 'Claude Code',
      redirectUris: ['http://localhost:1/cb'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      clientUri: null,
    });
    await touchOAuthClient(clientId);
    expect(db.docs.get(`${OAUTH_CLIENTS}/${clientId}`)).toHaveProperty('expiresAt');
  });
});
