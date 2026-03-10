import { adminDb } from '@/lib/firebase-admin';
import { decrypt, encrypt } from '@/lib/crypto';
import { refreshAccessToken } from './flow';
import type { OAuthProvider } from '@/lib/schemas';

type RefreshResult = {
  refreshed: number;
  failed: number;
  skipped: number;
  errors: Array<{ workspaceId: string; provider: string; error: string; productId?: string }>;
};

/** Max consecutive failures before we stop retrying an integration. */
const MAX_REFRESH_FAILURES = 5;

/** Errors that indicate a permanent failure — no point retrying. */
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

/**
 * Refresh a single integration document if its token is expiring soon.
 */
async function refreshIntegrationDoc(
  integRef: FirebaseFirestore.DocumentReference,
  provider: OAuthProvider,
  result: RefreshResult,
  errorContext: { workspaceId: string; productId?: string },
): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const integSnap = await integRef.get();

  if (!integSnap.exists) return;

  const data = integSnap.data()!;
  if (!data.oauthConnected) return;

  // Skip integrations that have permanently failed
  const failureCount = (data.refreshFailureCount as number) || 0;
  if (failureCount >= MAX_REFRESH_FAILURES) {
    result.skipped++;
    return;
  }

  // Page tokens from Meta page selection are long-lived (permanent).
  // Only refresh the user access token, not page tokens.
  // If this integration only has pageAccessTokenEncrypted (and no user token
  // that's expiring), skip it.
  if (provider === 'meta' && data.pageAccessTokenEncrypted && !data.tokenExpiresAt) {
    return;
  }

  if (!data.tokenExpiresAt) return;
  if (data.tokenExpiresAt > threshold) return;

  // Meta without refreshToken: extend user token via fb_exchange_token
  if (!data.refreshTokenEncrypted && provider === 'meta') {
    if (!data.accessTokenEncrypted) return;

    try {
      const currentToken = decrypt(data.accessTokenEncrypted as string);
      const newTokens = await refreshAccessToken('meta', currentToken);

      const newExpiresAt = newTokens.expiresIn
        ? new Date(now.getTime() + newTokens.expiresIn * 1000).toISOString()
        : null;

      await integRef.update({
        accessTokenEncrypted: encrypt(newTokens.accessToken),
        tokenExpiresAt: newExpiresAt,
        lastRefreshAt: now.toISOString(),
        lastRefreshError: null,
        refreshFailureCount: 0,
        status: 'connected',
        updatedAt: now.toISOString(),
      });

      result.refreshed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      const newCount = failureCount + 1;
      const permanent = isPermanentError(error);

      await integRef.update({
        status: permanent ? 'disconnected' : 'refresh_failed',
        lastRefreshError: error,
        refreshFailureCount: newCount,
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
    const refreshToken = decrypt(data.refreshTokenEncrypted as string);
    const newTokens = await refreshAccessToken(provider, refreshToken);

    const newExpiresAt = newTokens.expiresIn
      ? new Date(now.getTime() + newTokens.expiresIn * 1000).toISOString()
      : null;

    const updatePayload: Record<string, unknown> = {
      accessTokenEncrypted: encrypt(newTokens.accessToken),
      tokenExpiresAt: newExpiresAt,
      lastRefreshAt: now.toISOString(),
      lastRefreshError: null,
      refreshFailureCount: 0,
      status: 'connected',
      updatedAt: now.toISOString(),
    };

    // TikTok rotates refresh tokens — always store the new one
    if (newTokens.refreshToken && newTokens.refreshToken !== refreshToken) {
      updatePayload.refreshTokenEncrypted = encrypt(newTokens.refreshToken);
    }

    await integRef.update(updatePayload);
    result.refreshed++;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    const newCount = failureCount + 1;
    const permanent = isPermanentError(error);

    await integRef.update({
      status: permanent ? 'disconnected' : 'refresh_failed',
      lastRefreshError: error,
      refreshFailureCount: newCount,
      updatedAt: now.toISOString(),
    });
    result.failed++;
    result.errors.push({ ...errorContext, provider, error });
  }
}

/**
 * Scan all workspaces for OAuth integrations with tokens expiring within 24 hours.
 * - Workspace-level: Google (one account per workspace)
 * - Product-level: Meta, X, TikTok (per-product social integrations)
 */
export async function processTokenRefresh(): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, failed: 0, skipped: 0, errors: [] };

  const wsSnap = await adminDb.collection('workspaces').limit(200).get();

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;

    // 1. Workspace-level: Google
    const googleRef = adminDb.doc(`workspaces/${workspaceId}/integrations/google`);
    await refreshIntegrationDoc(googleRef, 'google', result, { workspaceId });

    // 2. Product-level: meta, x, tiktok
    const socialProviders: OAuthProvider[] = ['meta', 'tiktok', 'x'];
    const productsSnap = await adminDb
      .collection(`workspaces/${workspaceId}/products`)
      .limit(100)
      .get();

    for (const productDoc of productsSnap.docs) {
      const productId = productDoc.id;

      for (const provider of socialProviders) {
        const integRef = adminDb.doc(
          `workspaces/${workspaceId}/products/${productId}/integrations/${provider}`,
        );
        await refreshIntegrationDoc(integRef, provider, result, { workspaceId, productId });
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
