import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { PublicApiScope } from '@/lib/public-api/scopes';
import { hashToken, randomToken } from './pkce';

/**
 * Firestore records for the agent OAuth flow. Three collections, all
 * server-only (the rules default-deny) and all on the TTL list in
 * docs/operations/firestore-ttl.md:
 *
 *   oauth_clients         dynamically registered MCP clients
 *   oauth_codes           single-use authorization codes, keyed by hash
 *   oauth_refresh_tokens  rotating refresh tokens, keyed by hash
 *
 * Access tokens are not stored here: an access token IS a workspace API key
 * (`workspaces/{ws}/api_clients/{id}`), so the existing key authentication,
 * scope checks, brand binding, and revocation apply unchanged.
 */

export const OAUTH_CLIENTS = 'oauth_clients';
export const OAUTH_CODES = 'oauth_codes';
export const OAUTH_REFRESH_TOKENS = 'oauth_refresh_tokens';

/** A client that has not exchanged a token in this long is forgotten. */
export const CLIENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Access token (API key) lifetime; refreshed by rotating the key secret. */
export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type TokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export type OAuthClientRecord = {
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  /** Only when the client asked for a secret-based auth method. */
  secretHash: string | null;
  clientUri: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /**
   * Absent on first-party clients, which are seeded by
   * scripts/seed-oauth-clients.mjs and must never age out: the Firestore TTL
   * policy only deletes documents that carry the field.
   */
  expiresAt?: Timestamp;
  /**
   * Registered by Markaestro itself for a connector dialog that asks for a
   * client id instead of registering dynamically (grok.com). Public, PKCE
   * only, exempt from the idle TTL. Never set by the registration endpoint.
   */
  firstParty?: boolean;
};

export type AuthorizationCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: PublicApiScope[];
  workspaceId: string;
  /** Empty string when `allBrands` is true; the chosen brand otherwise. */
  productId: string;
  /** Sitewide grant: the minted key can act on every brand in the workspace. */
  allBrands: boolean;
  uid: string;
  clientName: string;
  /**
   * RFC 8707 resource the client asked for at authorization, already
   * normalized to the canonical MCP endpoint URL; null when it sent none.
   * The token endpoint refuses a code redeemed for a different resource.
   */
  resource: string | null;
  createdAt: string;
  usedAt: string | null;
  expiresAt: Timestamp;
};

export type RefreshTokenRecord = {
  clientId: string;
  workspaceId: string;
  apiClientId: string;
  uid: string;
  scopes: PublicApiScope[];
  createdAt: string;
  expiresAt: Timestamp;
};

function nowIso() {
  return new Date().toISOString();
}

function expiry(ttlMs: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + ttlMs);
}

function isExpired(ts: Timestamp | undefined): boolean {
  return !ts || ts.toMillis() < Date.now();
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function createOAuthClient(input: {
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  clientUri: string | null;
}): Promise<{ clientId: string; clientSecret: string | null; createdAt: string }> {
  const clientId = `oc_${crypto.randomUUID()}`;
  const clientSecret = input.tokenEndpointAuthMethod === 'none' ? null : randomToken(32);
  const createdAt = nowIso();
  const record: OAuthClientRecord = {
    clientName: input.clientName,
    redirectUris: input.redirectUris,
    grantTypes: input.grantTypes,
    responseTypes: input.responseTypes,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    secretHash: clientSecret ? hashToken(clientSecret) : null,
    clientUri: input.clientUri,
    createdAt,
    lastUsedAt: null,
    expiresAt: expiry(CLIENT_TTL_MS),
  };
  await adminDb.collection(OAUTH_CLIENTS).doc(clientId).set(record);
  return { clientId, clientSecret, createdAt };
}

/** Dynamically registered ids are `oc_<uuid>`; seeded first-party ids are `markaestro-<slug>`. */
export function isOAuthClientId(clientId: string): boolean {
  return /^oc_[0-9a-f-]{36}$/.test(clientId) || /^markaestro-[a-z0-9-]{2,40}$/.test(clientId);
}

export async function getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
  if (!isOAuthClientId(clientId)) return null;
  const snap = await adminDb.collection(OAUTH_CLIENTS).doc(clientId).get();
  if (!snap.exists) return null;
  const data = snap.data() as OAuthClientRecord;
  // A seeded client is exempt from the idle TTL; a registered one without an
  // expiry is malformed and treated as expired rather than as immortal.
  if (data.firstParty === true) return data;
  if (isExpired(data.expiresAt)) return null;
  return data;
}

/**
 * A token exchange proves the client is alive; push its expiry out. First-party
 * clients only record the use: writing `expiresAt` on them would put them
 * back under the TTL policy.
 */
export async function touchOAuthClient(clientId: string, client?: Pick<OAuthClientRecord, 'firstParty'>): Promise<void> {
  const patch: Record<string, unknown> = { lastUsedAt: nowIso() };
  if (client?.firstParty !== true) patch.expiresAt = expiry(CLIENT_TTL_MS);
  await adminDb.collection(OAUTH_CLIENTS).doc(clientId).update(patch);
}

// ── Authorization codes ─────────────────────────────────────────────────────

export async function createAuthorizationCode(
  input: Omit<AuthorizationCodeRecord, 'createdAt' | 'usedAt' | 'expiresAt' | 'resource' | 'allBrands'>
    & { resource?: string | null; allBrands?: boolean },
): Promise<string> {
  const code = randomToken(32);
  const record: AuthorizationCodeRecord = {
    ...input,
    resource: input.resource ?? null,
    allBrands: input.allBrands ?? false,
    createdAt: nowIso(),
    usedAt: null,
    expiresAt: expiry(CODE_TTL_MS),
  };
  await adminDb.collection(OAUTH_CODES).doc(hashToken(code)).set(record);
  return code;
}

/**
 * Atomically claim a code. Returns null when the code is unknown, expired,
 * or already used; a second exchange racing the first loses inside the
 * transaction rather than minting a second key.
 */
export async function consumeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null> {
  if (typeof code !== 'string' || code.length < 20 || code.length > 200) return null;
  const ref = adminDb.collection(OAUTH_CODES).doc(hashToken(code));
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as AuthorizationCodeRecord;
    if (data.usedAt || isExpired(data.expiresAt)) return null;
    tx.update(ref, { usedAt: nowIso() });
    return data;
  });
}

// ── Refresh tokens ──────────────────────────────────────────────────────────

export async function createRefreshToken(
  input: Omit<RefreshTokenRecord, 'createdAt' | 'expiresAt'>,
): Promise<string> {
  const token = randomToken(32);
  const record: RefreshTokenRecord = {
    ...input,
    createdAt: nowIso(),
    expiresAt: expiry(REFRESH_TOKEN_TTL_MS),
  };
  await adminDb.collection(OAUTH_REFRESH_TOKENS).doc(hashToken(token)).set(record);
  return token;
}

/** Delete-on-read: a refresh token is good for exactly one rotation. */
export async function consumeRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const ref = adminDb.collection(OAUTH_REFRESH_TOKENS).doc(hashToken(token));
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as RefreshTokenRecord;
    tx.delete(ref);
    if (isExpired(data.expiresAt)) return null;
    return data;
  });
}

export async function peekRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const snap = await adminDb.collection(OAUTH_REFRESH_TOKENS).doc(hashToken(token)).get();
  if (!snap.exists) return null;
  return snap.data() as RefreshTokenRecord;
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await adminDb.collection(OAUTH_REFRESH_TOKENS).doc(hashToken(token)).delete();
}
