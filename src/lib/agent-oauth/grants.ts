import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { safeCompare } from '@/lib/crypto';
import { buildApiKey, parseApiKey, hashSecret } from '@/lib/public-api/keys';
import { invalidateApiClientAuthCache } from '@/lib/public-api/auth';
import type { PublicApiScope } from '@/lib/public-api/scopes';
import { OAuthError } from './errors';
import { hashToken, verifyPkce } from './pkce';
import { redirectUriMatches } from './redirect-uri';
import {
  ACCESS_TOKEN_TTL_MS,
  consumeAuthorizationCode,
  consumeRefreshToken,
  createRefreshToken,
  deleteRefreshToken,
  getOAuthClient,
  peekRefreshToken,
  touchOAuthClient,
  type OAuthClientRecord,
} from './store';

/**
 * The token endpoint's two grants.
 *
 * An access token is a workspace API key. The authorization-code grant mints
 * one (bound to the brand the user chose at consent), the refresh grant
 * rotates its secret and extends its expiry. Everything downstream of the
 * key (scopes, brand binding, subscription entitlement, rate limits, the
 * Settings list, revocation) is the existing API-key machinery.
 */

export type TokenRequest = {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** Parse a form-encoded or JSON token request body. */
export async function readTokenRequest(req: Request): Promise<TokenRequest & Record<string, string>> {
  const contentType = req.headers.get('content-type') || '';
  const out: Record<string, string> = {};
  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
    return out;
  }
  const text = await req.text();
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

/**
 * Identify and authenticate the client. Public clients (`none`) present only
 * their id; confidential ones present the secret in the body or as HTTP
 * Basic. A client that registered with a secret must always present it.
 */
export async function authenticateClient(
  req: Request,
  body: TokenRequest,
): Promise<{ clientId: string; client: OAuthClientRecord }> {
  let clientId = body.client_id?.trim() || '';
  let clientSecret = body.client_secret || '';
  const authorization = req.headers.get('authorization') || '';
  if (/^basic\s+/i.test(authorization)) {
    const decoded = Buffer.from(authorization.replace(/^basic\s+/i, ''), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep > 0) {
      clientId = decodeURIComponent(decoded.slice(0, sep));
      clientSecret = decodeURIComponent(decoded.slice(sep + 1));
    }
  }
  if (!clientId) throw new OAuthError('invalid_client', 'client_id is required.', 401);
  const client = await getOAuthClient(clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client. Register again.', 401);
  if (client.tokenEndpointAuthMethod !== 'none') {
    if (!clientSecret || !client.secretHash || !safeCompare(client.secretHash, hashToken(clientSecret))) {
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    }
  }
  return { clientId, client };
}

function apiClientName(clientName: string): string {
  const trimmed = clientName.trim().slice(0, 60);
  return trimmed || 'Connected agent';
}

export async function exchangeAuthorizationCode(req: Request, body: TokenRequest): Promise<TokenResponse> {
  const { clientId, client } = await authenticateClient(req, body);
  if (!body.code) throw new OAuthError('invalid_request', 'code is required.');
  if (!body.code_verifier) throw new OAuthError('invalid_request', 'code_verifier is required (PKCE).');

  const record = await consumeAuthorizationCode(body.code);
  if (!record) throw new OAuthError('invalid_grant', 'Authorization code is invalid, expired, or already used.');
  if (record.clientId !== clientId) throw new OAuthError('invalid_grant', 'Authorization code was issued to another client.');
  if (body.redirect_uri && !redirectUriMatches(record.redirectUri, body.redirect_uri)) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request.');
  }
  if (!verifyPkce(body.code_verifier, record.codeChallenge)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  }

  // Mint the key. Everything the consent step verified (admin role, verified
  // email, active subscription, brand exists) is carried in the code record.
  const apiClientId = `cli_${crypto.randomUUID()}`;
  const key = buildApiKey(record.workspaceId, apiClientId, 'live');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();
  await adminDb.doc(`workspaces/${record.workspaceId}/api_clients/${apiClientId}`).set({
    name: apiClientName(record.clientName || client.clientName),
    ownerUid: record.uid,
    scopes: record.scopes,
    status: 'active',
    archived: false,
    keyPrefix: key.keyPrefix,
    secretHash: key.secretHash,
    createdAt,
    expiresAt,
    productId: record.productId,
    mode: 'live',
    createdEmailVerified: true,
    revokedAt: null,
    lastUsedAt: null,
    // Provenance: minted by the agent OAuth flow rather than by hand in
    // Settings. Settings shows these as connected agents.
    origin: 'oauth',
    oauthClientId: clientId,
  });

  const refreshToken = await createRefreshToken({
    clientId,
    workspaceId: record.workspaceId,
    apiClientId,
    uid: record.uid,
    scopes: record.scopes,
  });
  await touchOAuthClient(clientId);

  return {
    access_token: key.token,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: record.scopes.join(' '),
  };
}

export async function refreshAccessToken(req: Request, body: TokenRequest): Promise<TokenResponse> {
  const { clientId } = await authenticateClient(req, body);
  if (!body.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required.');

  const record = await consumeRefreshToken(body.refresh_token);
  if (!record) throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired.');
  if (record.clientId !== clientId) throw new OAuthError('invalid_grant', 'Refresh token was issued to another client.');

  const ref = adminDb.doc(`workspaces/${record.workspaceId}/api_clients/${record.apiClientId}`);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as { status?: string; mode?: string; scopes?: PublicApiScope[] }) : null;
  if (!data || data.status !== 'active') {
    // The key was revoked or archived in Settings. The refresh token is
    // already gone (delete-on-read), so the agent has to be re-authorised.
    throw new OAuthError('invalid_grant', 'Access was revoked. Sign in again to reconnect.');
  }

  const mode = data.mode === 'test' ? 'test' : 'live';
  const key = buildApiKey(record.workspaceId, record.apiClientId, mode);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();
  await ref.update({
    keyPrefix: key.keyPrefix,
    secretHash: key.secretHash,
    expiresAt,
    rotatedAt: new Date().toISOString(),
  });
  invalidateApiClientAuthCache(ref.path);

  const scopes = data.scopes ?? record.scopes;
  const refreshToken = await createRefreshToken({
    clientId,
    workspaceId: record.workspaceId,
    apiClientId: record.apiClientId,
    uid: record.uid,
    scopes,
  });
  await touchOAuthClient(clientId);

  return {
    access_token: key.token,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
}

/**
 * RFC 7009 revocation. The token may be an access token (an API key) or a
 * refresh token; either way the connected key is revoked so both stop
 * working. Always succeeds from the caller's point of view: revoking an
 * unknown token is not an error, and the response must not reveal whether
 * a token existed.
 */
export async function revokeToken(token: string): Promise<void> {
  const parsed = parseApiKey(token);
  if (parsed) {
    const ref = adminDb.doc(`workspaces/${parsed.workspaceId}/api_clients/${parsed.clientId}`);
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() as { secretHash?: string; status?: string }) : null;
    if (data?.secretHash && safeCompare(data.secretHash, hashSecret(parsed.secret)) && data.status === 'active') {
      await ref.update({ status: 'revoked', revokedAt: new Date().toISOString(), revokedReason: 'oauth_revoke' });
      invalidateApiClientAuthCache(ref.path);
    }
    return;
  }
  const record = await peekRefreshToken(token);
  if (!record) return;
  await deleteRefreshToken(token);
  const ref = adminDb.doc(`workspaces/${record.workspaceId}/api_clients/${record.apiClientId}`);
  const snap = await ref.get();
  if (snap.exists && (snap.data() as { status?: string }).status === 'active') {
    await ref.update({ status: 'revoked', revokedAt: new Date().toISOString(), revokedReason: 'oauth_revoke' });
    invalidateApiClientAuthCache(ref.path);
  }
}
