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
import {
  connectionStatusAfterRefreshFailure,
  shouldAttemptScheduledTokenRefresh,
  tokenRefreshRetryDelayMs,
} from './token-refresh-policy';

type RefreshResult = {
  refreshed: number;
  failed: number;
  skipped: number;
  errors: Array<{ workspaceId: string; provider: string; error: string; productId?: string }>;
};

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

async function recordRefreshFailure(
  connRef: FirebaseFirestore.DocumentReference,
  data: PlatformConnection,
  provider: OAuthProvider,
  failureCount: number,
  error: string,
  now: Date,
  result: RefreshResult,
  errorContext: { workspaceId: string; productId?: string },
  storageProvider?: string,
): Promise<void> {
  const newCount = failureCount + 1;
  const permanent = isPermanentError(error);

  await connRef.update({
    status: connectionStatusAfterRefreshFailure(data.tokenExpiresAt, now, permanent),
    'metadata.lastRefreshError': error,
    'metadata.refreshFailureCount': newCount,
    'metadata.nextRefreshAttemptAt': permanent
      ? null
      : new Date(now.getTime() + tokenRefreshRetryDelayMs(newCount)).toISOString(),
    updatedAt: now.toISOString(),
  });

  result.failed++;
  result.errors.push({ ...errorContext, provider: storageProvider || provider, error });
}

async function refreshConnectionDoc(
  connRef: FirebaseFirestore.DocumentReference,
  provider: OAuthProvider,
  result: RefreshResult,
  errorContext: { workspaceId: string; productId?: string },
  options: { storageProvider?: string; linkedinCredentialKind?: LinkedInCredentialKind } = {},
): Promise<void> {
  const now = new Date();
  const connSnap = await connRef.get();

  if (!connSnap.exists) return;

  const data = connSnap.data() as PlatformConnection;
  const failureCount = Number(data.metadata.refreshFailureCount) || 0;

  // Meta page tokens are long-lived; only refresh user tokens
  if (provider === 'meta' && data.metadata.pageAccessTokenEncrypted && !data.tokenExpiresAt) {
    return;
  }

  if (!shouldAttemptScheduledTokenRefresh(provider, data, now)) {
    result.skipped++;
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
        'metadata.nextRefreshAttemptAt': null,
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
      await recordRefreshFailure(
        connRef,
        data,
        provider,
        failureCount,
        error,
        now,
        result,
        errorContext,
        options.storageProvider,
      );
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
      'metadata.nextRefreshAttemptAt': null,
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
    await recordRefreshFailure(
      connRef,
      data,
      provider,
      failureCount,
      error,
      now,
      result,
      errorContext,
      options.storageProvider,
    );
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
    'metadata.nextRefreshAttemptAt': null,
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
 * Scan all workspaces for platform connections that are inside their
 * provider-specific refresh window or are due for transient-error recovery.
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
  const cutoffDate = new Date(Date.now() - 15 * 60 * 1000);
  const { Timestamp } = await import('firebase-admin/firestore');
  // Read both representations for one rolling-deploy window. New state docs
  // use Timestamp so Firestore TTL can remove them automatically; the string
  // query drains states written by older instances.
  const [timestampSnap, legacySnap] = await Promise.all([
    adminDb.collection('oauth_states')
      .where('expiresAt', '<', Timestamp.fromDate(cutoffDate))
      .limit(100)
      .get(),
    adminDb.collection('oauth_states')
      .where('expiresAt', '<', cutoffDate.toISOString())
      .limit(100)
      .get(),
  ]);
  const docs = new Map([...timestampSnap.docs, ...legacySnap.docs].map((doc) => [doc.id, doc]));

  const batch = adminDb.batch();
  for (const doc of docs.values()) {
    batch.delete(doc.ref);
  }

  if (docs.size > 0) {
    await batch.commit();
  }

  return docs.size;
}
