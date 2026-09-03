import { beforeEach, describe, expect, it, vi } from 'vitest';
// Hoisted with the mock factory: vi.mock runs before imports, so the fake
// has to exist before any module under test touches adminDb.
const db = await vi.hoisted(async () => {
  const { FakeFirestore } = await import('./fake-firestore');
  return new FakeFirestore();
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db }));

import { exchangeAuthorizationCode, refreshAccessToken, revokeToken } from '../grants';
import { OAuthError } from '../errors';
import { randomToken, s256Challenge, hashToken } from '../pkce';
import { createAuthorizationCode, createOAuthClient, OAUTH_CODES, OAUTH_REFRESH_TOKENS } from '../store';
import { parseApiKey, hashSecret } from '@/lib/public-api/keys';

const REDIRECT = 'http://localhost:41234/callback';

async function registerClient(overrides: Partial<Parameters<typeof createOAuthClient>[0]> = {}) {
  return createOAuthClient({
    clientName: 'Claude Code',
    redirectUris: [REDIRECT],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    clientUri: null,
    ...overrides,
  });
}

/** What the consent page does after the admin clicks Allow. */
async function consent(clientId: string, verifier: string) {
  return createAuthorizationCode({
    clientId,
    redirectUri: REDIRECT,
    codeChallenge: s256Challenge(verifier),
    scopes: ['products.read', 'posts.write', 'posts.publish'],
    workspaceId: 'ws_1',
    productId: 'prod_1',
    uid: 'user_1',
    clientName: 'Claude Code',
  });
}

function tokenReq(headers: Record<string, string> = {}) {
  return new Request('https://markaestro.com/api/public/v1/oauth/token', { method: 'POST', headers });
}

async function expectOAuthError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(OAuthError);
  await promise.catch((error: OAuthError) => expect(error.code).toBe(code));
}

describe('authorization-code grant', () => {
  beforeEach(() => db.docs.clear());

  it('mints a brand-bound API key and a refresh token from a valid code', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);

    const tokens = await exchangeAuthorizationCode(tokenReq(), {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });

    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope).toBe('products.read posts.write posts.publish');
    expect(tokens.expires_in).toBe(30 * 24 * 60 * 60);

    const parsed = parseApiKey(tokens.access_token);
    expect(parsed?.workspaceId).toBe('ws_1');
    expect(parsed?.mode).toBe('live');
    const keyDoc = db.docs.get(`workspaces/ws_1/api_clients/${parsed?.clientId}`);
    expect(keyDoc).toMatchObject({
      name: 'Claude Code',
      ownerUid: 'user_1',
      productId: 'prod_1',
      status: 'active',
      mode: 'live',
      origin: 'oauth',
      oauthClientId: clientId,
      scopes: ['products.read', 'posts.write', 'posts.publish'],
    });
    // The secret is stored hashed, and the hash matches the token handed out.
    expect(keyDoc?.secretHash).toBe(hashSecret(parsed!.secret));

    // The refresh token is stored by hash, never in the clear.
    const refreshDoc = db.docs.get(`${OAUTH_REFRESH_TOKENS}/${hashToken(tokens.refresh_token)}`);
    expect(refreshDoc).toMatchObject({ clientId, apiClientId: parsed?.clientId, workspaceId: 'ws_1' });
  });

  it('refuses a wrong PKCE verifier and burns the code', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);

    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: randomToken(48),
      }),
      'invalid_grant',
    );
    // The failed attempt consumed the code: a retry with the right verifier
    // must not succeed, and no key was minted.
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
      }),
      'invalid_grant',
    );
    expect(db.under('workspaces/')).toHaveLength(0);
  });

  it('is single-use: a second exchange of the same code fails', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    const body = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier };
    await exchangeAuthorizationCode(tokenReq(), body);
    await expectOAuthError(exchangeAuthorizationCode(tokenReq(), body), 'invalid_grant');
    expect(db.under('workspaces/')).toHaveLength(1);
  });

  it('refuses a code issued to another client, and an unknown client', async () => {
    const a = await registerClient();
    const b = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(a.clientId, verifier);
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), { client_id: b.clientId, code, code_verifier: verifier }),
      'invalid_grant',
    );
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), { client_id: 'oc_00000000-0000-0000-0000-000000000000', code, code_verifier: verifier }),
      'invalid_client',
    );
  });

  it('refuses a redirect_uri that differs from the one consented to', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), {
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: 'https://evil.example/callback',
      }),
      'invalid_grant',
    );
  });

  it('refuses an expired code', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    const [entry] = db.under(`${OAUTH_CODES}/`);
    const { Timestamp } = await import('firebase-admin/firestore');
    db.docs.set(entry.path, { ...entry.data, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code, code_verifier: verifier }),
      'invalid_grant',
    );
  });

  it('requires the secret for a confidential client, via body or HTTP Basic', async () => {
    const { clientId, clientSecret } = await registerClient({ tokenEndpointAuthMethod: 'client_secret_basic' });
    expect(clientSecret).toBeTruthy();
    const verifier = randomToken(48);

    const code1 = await consent(clientId, verifier);
    await expectOAuthError(
      exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code: code1, code_verifier: verifier }),
      'invalid_client',
    );

    const code2 = await consent(clientId, verifier);
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokens = await exchangeAuthorizationCode(tokenReq({ authorization: `Basic ${basic}` }), {
      code: code2,
      code_verifier: verifier,
    });
    expect(tokens.access_token.startsWith('mk_live_')).toBe(true);
  });
});

describe('refresh-token grant', () => {
  beforeEach(() => db.docs.clear());

  async function connect() {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    const tokens = await exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code, code_verifier: verifier });
    return { clientId, tokens };
  }

  it('rotates the key secret and the refresh token, keeping the same key record', async () => {
    const { clientId, tokens } = await connect();
    const before = parseApiKey(tokens.access_token)!;

    const rotated = await refreshAccessToken(tokenReq(), { client_id: clientId, refresh_token: tokens.refresh_token });
    const after = parseApiKey(rotated.access_token)!;

    expect(after.clientId).toBe(before.clientId);
    expect(after.secret).not.toBe(before.secret);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.scope).toBe(tokens.scope);

    const keyDoc = db.docs.get(`workspaces/ws_1/api_clients/${after.clientId}`)!;
    expect(keyDoc.secretHash).toBe(hashSecret(after.secret));
    expect(keyDoc.status).toBe('active');
    expect(typeof keyDoc.rotatedAt).toBe('string');

    // The old refresh token is gone; only the new one exists.
    expect(db.under(`${OAUTH_REFRESH_TOKENS}/`)).toHaveLength(1);
    await expectOAuthError(
      refreshAccessToken(tokenReq(), { client_id: clientId, refresh_token: tokens.refresh_token }),
      'invalid_grant',
    );
  });

  it('refuses to refresh a key that was revoked in Settings', async () => {
    const { clientId, tokens } = await connect();
    const { clientId: apiClientId } = parseApiKey(tokens.access_token)!;
    const path = `workspaces/ws_1/api_clients/${apiClientId}`;
    db.docs.set(path, { ...db.docs.get(path)!, status: 'revoked' });

    await expectOAuthError(
      refreshAccessToken(tokenReq(), { client_id: clientId, refresh_token: tokens.refresh_token }),
      'invalid_grant',
    );
    // Delete-on-read: the refresh token cannot be replayed after revocation.
    expect(db.under(`${OAUTH_REFRESH_TOKENS}/`)).toHaveLength(0);
  });

  it('refuses a refresh token presented by a different client', async () => {
    const { tokens } = await connect();
    const other = await registerClient();
    await expectOAuthError(
      refreshAccessToken(tokenReq(), { client_id: other.clientId, refresh_token: tokens.refresh_token }),
      'invalid_grant',
    );
  });
});

describe('revocation', () => {
  beforeEach(() => db.docs.clear());

  it('revokes the key behind an access token, and behind a refresh token', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    const tokens = await exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code, code_verifier: verifier });
    const { clientId: apiClientId } = parseApiKey(tokens.access_token)!;
    const path = `workspaces/ws_1/api_clients/${apiClientId}`;

    await revokeToken(tokens.access_token);
    expect(db.docs.get(path)?.status).toBe('revoked');

    // Second connection, revoked through its refresh token instead.
    const code2 = await consent(clientId, verifier);
    const tokens2 = await exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code: code2, code_verifier: verifier });
    const { clientId: apiClientId2 } = parseApiKey(tokens2.access_token)!;
    await revokeToken(tokens2.refresh_token);
    expect(db.docs.get(`workspaces/ws_1/api_clients/${apiClientId2}`)?.status).toBe('revoked');
    // Only the first connection's refresh token remains, and it is useless:
    // refreshing checks the key's status, which is now revoked.
    const remaining = db.under(`${OAUTH_REFRESH_TOKENS}/`);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].data.apiClientId).toBe(apiClientId);
  });

  it('ignores an unknown token and a wrong-secret key without touching anything', async () => {
    const { clientId } = await registerClient();
    const verifier = randomToken(48);
    const code = await consent(clientId, verifier);
    const tokens = await exchangeAuthorizationCode(tokenReq(), { client_id: clientId, code, code_verifier: verifier });
    const parsed = parseApiKey(tokens.access_token)!;

    await revokeToken('not-a-token');
    await revokeToken(`mk_live_${parsed.workspaceId}.${parsed.clientId}.wrongsecret`);
    expect(db.docs.get(`workspaces/ws_1/api_clients/${parsed.clientId}`)?.status).toBe('active');
  });
});
