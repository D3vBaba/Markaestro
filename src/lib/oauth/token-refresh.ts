import { adminDb } from '@/lib/firebase-admin';
import { decrypt, encrypt } from '@/lib/crypto';
import { refreshAccessToken } from './flow';
import type { OAuthProvider } from '@/lib/schemas';
import { getConnectionRef } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';

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
): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const connSnap = await connRef.get();

  if (!connSnap.exists) return;

  const data = connSnap.data() as PlatformConnection;
  if (data.status !== 'connected') return;

  const failureCount = (data.metadata.refreshFailureCount as number) || 0;
  if (failureCount >= MAX_REFRESH_FAILURES) {
    result.skipped++;
    return;
  }

  // Meta page tokens are long-lived; only refresh user tokens
  if (provider === 'meta' && data.metadata.pageAccessTokenEncrypted && !data.tokenExpiresAt) {
    return;
  }

  if (!data.tokenExpiresAt) return;
  if (data.tokenExpiresAt > threshold) return;

  // Meta without refreshToken: extend user token via fb_exchange_token
  if (!data.refreshTokenEncrypted && provider === 'meta') {
    if (!data.accessTokenEncrypted) return;

    try {
      const currentToken = decrypt(data.accessTokenEncrypted);
      const newTokens = await refreshAccessToken('meta', currentToken);

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
      result.errors.push({ ...errorContext, provider, error });
    }
    return;
  }

  // Standard refresh_token flow (Google, TikTok, X)
  if (!data.refreshTokenEncrypted) return;

  try {
    const refreshToken = decrypt(data.refreshTokenEncrypted);
    const newTokens = await refreshAccessToken(provider, refreshToken);

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
    result.errors.push({ ...errorContext, provider, error });
  }
}

/**
 * Scan all workspaces for platform connections with tokens expiring within 24 hours.
 */
export async function processTokenRefresh(): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, failed: 0, skipped: 0, errors: [] };

  const wsSnap = await adminDb.collection('workspaces').limit(200).get();

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;

    // Workspace-level: Google, Meta
    const googleRef = getConnectionRef(workspaceId, 'google');
    await refreshConnectionDoc(googleRef, 'google', result, { workspaceId });

    const metaRef = getConnectionRef(workspaceId, 'meta');
    await refreshConnectionDoc(metaRef, 'meta', result, { workspaceId });

    // Product-level: x, tiktok (Meta is now workspace-level)
    const socialProviders: OAuthProvider[] = ['tiktok', 'x'];
    const productsSnap = await adminDb
      .collection(`workspaces/${workspaceId}/products`)
      .limit(100)
      .get();

    for (const productDoc of productsSnap.docs) {
      const productId = productDoc.id;

      for (const provider of socialProviders) {
        const connRef = getConnectionRef(workspaceId, provider, productId);
        await refreshConnectionDoc(connRef, provider, result, { workspaceId, productId });
      }

      // Also try to refresh legacy product-level Meta connections (backward compat)
      const legacyMetaRef = getConnectionRef(workspaceId, 'meta', productId);
      const legacySnap = await legacyMetaRef.get();
      if (legacySnap.exists) {
        const legacyData = legacySnap.data() as PlatformConnection;
        if (legacyData.accessTokenEncrypted) {
          await refreshConnectionDoc(legacyMetaRef, 'meta', result, { workspaceId, productId });
        }
      }
    }
  }

  return result;
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
