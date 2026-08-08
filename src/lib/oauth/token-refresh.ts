import { adminDb } from '@/lib/firebase-admin';
import { decrypt, encrypt } from '@/lib/crypto';
import { refreshAccessToken } from './flow';
import type { OAuthProvider } from '@/lib/schemas';
import { listAllConnectionDocs, refForConnection } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import { getAllDocs } from '@/lib/firestore-pagination';
import {
  linkedinCredentialKindForProvider,
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PROFILE_PROVIDER,
} from '@/lib/platform/linkedin-providers';
import type { LinkedInCredentialKind } from '@/lib/platform/linkedin-providers';

type RefreshResult = {
  refreshed: number;
  failed: number;
  skipped: number;
  errors: Array<{ workspaceId: string; provider: string; error: string; productId?: string }>;
};

const MAX_REFRESH_FAILURES = 5;

const PERMANENT_ERROR_PATTERNS = [
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'access_denied',
  'OAuthException',
  'Error validating access token',
  'Session has expired',
  'The user has not authorized application',
  // graph.instagram.com blanket refusal (account or app setup not eligible
  // for the Instagram API) — surfaced as IG_LOGIN_UNSUPPORTED_MESSAGE.
  "couldn't authorize this account",
  'Unsupported request',
];

function isPermanentError(error: string): boolean {
  const lower = error.toLowerCase();
  return PERMANENT_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

async function refreshConnectionDoc(
  connRef: FirebaseFirestore.DocumentReference,
  provider: OAuthProvider,
  result: RefreshResult,
  errorContext: { workspaceId: string; productId?: string },
  options: { storageProvider?: string; linkedinCredentialKind?: LinkedInCredentialKind } = {},
): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const connSnap = await connRef.get();

  if (!connSnap.exists) return;

  const data = connSnap.data() as PlatformConnection;
  // Skip only permanently revoked connections. Connections in 'error' status
  // (from a transient refresh failure) should be retried — the
  // MAX_REFRESH_FAILURES counter below bounds how many times we try.
  if (data.status === 'revoked') return;

  const failureCount = (data.metadata.refreshFailureCount as number) || 0;
  if (failureCount >= MAX_REFRESH_FAILURES) {
    result.skipped++;
    return;
  }

  // Meta page tokens are long-lived; only refresh user tokens
  if (provider === 'meta' && data.metadata.pageAccessTokenEncrypted && !data.tokenExpiresAt) {
    return;
  }

  if (!data.tokenExpiresAt) {
    // Instagram Login connections whose long-lived exchange failed at connect
    // time are stored WITHOUT tokenExpiresAt (short-lived ~1h token). Skipping
    // them here left dead connections marked 'connected' forever — instead,
    // health-check them via refresh_access_token once the token is old enough
    // (Meta requires tokens to be ≥24h old before refresh). A hard refusal or
    // expiry marks the connection revoked so the UI says "reconnect".
    if (provider !== 'instagram') return;
    const updatedAtMs = Date.parse(data.updatedAt || '');
    if (Number.isFinite(updatedAtMs) && now.getTime() - updatedAtMs < 24 * 60 * 60 * 1000) {
      result.skipped++;
      return;
    }
  } else if (data.tokenExpiresAt > threshold) {
    return;
  }

  // Meta/Instagram/Threads without refreshToken: extend the existing token directly
  if (!data.refreshTokenEncrypted && (provider === 'meta' || provider === 'instagram' || provider === 'threads')) {
    if (!data.accessTokenEncrypted) return;

    try {
      const currentToken = decrypt(data.accessTokenEncrypted);
      const newTokens = await refreshAccessToken(provider, currentToken, {
        linkedinCredentialKind: options.linkedinCredentialKind,
      });

      const newExpiresAt = newTokens.expiresIn
        ? new Date(now.getTime() + newTokens.expiresIn * 1000).toISOString()
        : undefined;

      const updatePayload: Record<string, unknown> = {
        accessTokenEncrypted: encrypt(newTokens.accessToken),
        'metadata.lastRefreshAt': now.toISOString(),
        'metadata.lastRefreshError': null,
        'metadata.refreshFailureCount': 0,
        status: 'connected',
        updatedAt: now.toISOString(),
      };
      if (newExpiresAt) {
        updatePayload.tokenExpiresAt = newExpiresAt;
      }

      await connRef.update(updatePayload);

      result.refreshed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      const newCount = failureCount + 1;
      const permanent = isPermanentError(error);

      await connRef.update({
        status: permanent ? 'revoked' : 'error',
        'metadata.lastRefreshError': error,
        'metadata.refreshFailureCount': newCount,
        updatedAt: now.toISOString(),
      });
      result.failed++;
      result.errors.push({ ...errorContext, provider: options.storageProvider || provider, error });
    }
    return;
  }

  // Standard refresh_token flow (Google, TikTok, X)
  if (!data.refreshTokenEncrypted) return;

  try {
    const refreshToken = decrypt(data.refreshTokenEncrypted);
    const newTokens = await refreshAccessToken(provider, refreshToken, {
      linkedinCredentialKind: options.linkedinCredentialKind,
    });

    const newExpiresAt = newTokens.expiresIn
      ? new Date(now.getTime() + newTokens.expiresIn * 1000).toISOString()
      : undefined;

    const updatePayload: Record<string, unknown> = {
      accessTokenEncrypted: encrypt(newTokens.accessToken),
      'metadata.lastRefreshAt': now.toISOString(),
      'metadata.lastRefreshError': null,
      'metadata.refreshFailureCount': 0,
      status: 'connected',
      updatedAt: now.toISOString(),
    };

    if (newExpiresAt) {
      updatePayload.tokenExpiresAt = newExpiresAt;
    }
    if (newTokens.refreshToken && newTokens.refreshToken !== refreshToken) {
      updatePayload.refreshTokenEncrypted = encrypt(newTokens.refreshToken);
    }

    await connRef.update(updatePayload);
    result.refreshed++;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    const newCount = failureCount + 1;
    const permanent = isPermanentError(error);

    await connRef.update({
      status: permanent ? 'revoked' : 'error',
      'metadata.lastRefreshError': error,
      'metadata.refreshFailureCount': newCount,
      updatedAt: now.toISOString(),
    });
    result.failed++;
    result.errors.push({ ...errorContext, provider: options.storageProvider || provider, error });
  }
}

/**
 * Refresh a single connection's access token on demand (e.g. immediately
 * before publishing) using its refresh token. Persists the new tokens to
 * Firestore and returns a connection carrying the fresh encrypted access
 * token, or null if the connection has no refresh token to refresh with.
 *
 * Unlike processTokenRefresh (the scheduled cron path), this ignores the 24h
 * expiry window — the caller decides when a refresh is warranted.
 */
export async function refreshConnectionToken(
  workspaceId: string,
  provider: OAuthProvider,
  connection: PlatformConnection,
  productId?: string,
): Promise<PlatformConnection | null> {
  if (!connection.refreshTokenEncrypted) return null;

  // Refresh the exact document this connection came from — a brand can have
  // several accounts linked for the same provider.
  const connRef = refForConnection({ ...connection, workspaceId, productId });
  const now = new Date();
  const refreshToken = decrypt(connection.refreshTokenEncrypted);
  const newTokens = await refreshAccessToken(provider, refreshToken);

  const newExpiresAt = newTokens.expiresIn
    ? new Date(now.getTime() + newTokens.expiresIn * 1000).toISOString()
    : undefined;

  const accessTokenEncrypted = encrypt(newTokens.accessToken);
  let refreshTokenEncrypted = connection.refreshTokenEncrypted;

  const updatePayload: Record<string, unknown> = {
    accessTokenEncrypted,
    'metadata.lastRefreshAt': now.toISOString(),
    'metadata.lastRefreshError': null,
    'metadata.refreshFailureCount': 0,
    status: 'connected',
    updatedAt: now.toISOString(),
  };
  if (newExpiresAt) {
    updatePayload.tokenExpiresAt = newExpiresAt;
  }
  if (newTokens.refreshToken && newTokens.refreshToken !== refreshToken) {
    refreshTokenEncrypted = encrypt(newTokens.refreshToken);
    updatePayload.refreshTokenEncrypted = refreshTokenEncrypted;
  }

  await connRef.update(updatePayload);

  return {
    ...connection,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    ...(newExpiresAt ? { tokenExpiresAt: newExpiresAt } : {}),
  };
}

/**
 * Scan all workspaces for platform connections with tokens expiring within 24 hours.
 */
export async function processTokenRefresh(): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, failed: 0, skipped: 0, errors: [] };

  const wsDocs = await getAllDocs('workspaces');

  for (const ws of wsDocs) {
    const workspaceId = ws.id;

    // Meta's app-user credential is workspace-scoped. Product Meta documents
    // only own Page selections and Page tokens; refreshing copied product user
    // tokens can incorrectly mark otherwise-healthy Page connections revoked.
    for (const connection of await listAllConnectionDocs(workspaceId)) {
      if (connection.provider !== 'meta') continue;
      await refreshConnectionDoc(refForConnection(connection), 'meta', result, { workspaceId });
    }

    // Product-level OAuth. Enumerate the actual connection documents rather
    // than guessing ids: a brand can have many accounts linked per provider.
    const productDocs = await getAllDocs(`workspaces/${workspaceId}/products`);

    for (const productDoc of productDocs) {
      const productId = productDoc.id;

      // Every document, including pending grants that the display list hides
      // once destinations exist — their token is what enumerates more
      // Pages/boards later, so it must not be left to expire.
      for (const connection of await listAllConnectionDocs(workspaceId, productId)) {
        const provider = refreshableProvider(connection.provider);
        if (!provider) continue;

        await refreshConnectionDoc(
          refForConnection({ ...connection, workspaceId, productId }),
          provider,
          result,
          { workspaceId, productId },
          {
            storageProvider: connection.provider,
            linkedinCredentialKind: linkedinCredentialKindForProvider(connection.provider),
          },
        );
      }
    }
  }

  return result;
}

// Meta is deliberately absent: product Meta documents hold a copy of the
// workspace user token plus a long-lived Page token. Refreshing those copies
// can mark otherwise-healthy Page connections revoked, so only the canonical
// workspace credential is refreshed.
const PRODUCT_REFRESH_PROVIDERS = new Set<string>([
  'instagram',
  'tiktok',
  'threads',
  'pinterest',
]);

/** Map a stored provider key to the OAuth provider whose refresh flow applies. */
function refreshableProvider(storageProvider: string): OAuthProvider | null {
  if (
    storageProvider === LINKEDIN_PROFILE_PROVIDER ||
    storageProvider === LINKEDIN_COMMUNITY_PROVIDER ||
    storageProvider === 'linkedin'
  ) {
    return 'linkedin';
  }
  return PRODUCT_REFRESH_PROVIDERS.has(storageProvider)
    ? (storageProvider as OAuthProvider)
    : null;
}

/**
 * Clean up expired OAuth state documents.
 */
export async function cleanupExpiredOAuthStates(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const snap = await adminDb
    .collection('oauth_states')
    .where('expiresAt', '<', cutoff)
    .limit(100)
    .get();

  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }

  if (snap.size > 0) {
    await batch.commit();
  }

  return snap.size;
}
