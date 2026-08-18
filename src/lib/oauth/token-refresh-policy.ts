import type { OAuthProvider } from '@/lib/schemas';
import type { PlatformConnection } from '@/lib/platform/types';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_TOKEN_REFRESH_WINDOW_MS = 24 * HOUR_MS;
export const TIKTOK_TOKEN_REFRESH_WINDOW_MS = HOUR_MS;
export const TOKEN_REFRESH_RETRY_BASE_MS = MINUTE_MS;
export const TOKEN_REFRESH_RETRY_MAX_MS = 30 * MINUTE_MS;

type RefreshScheduleConnection = Pick<
  PlatformConnection,
  'status' | 'tokenExpiresAt' | 'updatedAt' | 'metadata'
>;

/**
 * TikTok access tokens last about 24 hours. Using the general 24-hour window
 * made a newly refreshed token eligible again on the next worker tick, so it
 * was refreshed every minute. Other providers retain their existing window.
 */
export function tokenRefreshWindowMs(provider: OAuthProvider): number {
  return provider === 'tiktok'
    ? TIKTOK_TOKEN_REFRESH_WINDOW_MS
    : DEFAULT_TOKEN_REFRESH_WINDOW_MS;
}

/**
 * Exponential retry delay for transient provider failures. Attempts never stop
 * permanently; they settle at a 30-minute cadence until the provider recovers.
 */
export function tokenRefreshRetryDelayMs(failureCount: number): number {
  const normalizedCount = Math.max(1, Math.floor(failureCount));
  const exponent = Math.min(normalizedCount - 1, 10);
  return Math.min(
    TOKEN_REFRESH_RETRY_BASE_MS * Math.pow(2, exponent),
    TOKEN_REFRESH_RETRY_MAX_MS,
  );
}

export function accessTokenIsStillValid(tokenExpiresAt: string | undefined, now: Date): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAtMs = Date.parse(tokenExpiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

export function connectionStatusAfterRefreshFailure(
  tokenExpiresAt: string | undefined,
  now: Date,
  permanent: boolean,
): PlatformConnection['status'] {
  if (permanent) return 'revoked';
  return accessTokenIsStillValid(tokenExpiresAt, now) ? 'connected' : 'error';
}

/** Decide whether the scheduled worker should attempt this connection now. */
export function shouldAttemptScheduledTokenRefresh(
  provider: OAuthProvider,
  connection: RefreshScheduleConnection,
  now: Date,
): boolean {
  if (connection.status === 'revoked') return false;

  const nextAttemptAt = connection.metadata.nextRefreshAttemptAt;
  if (typeof nextAttemptAt === 'string') {
    const nextAttemptAtMs = Date.parse(nextAttemptAt);
    if (Number.isFinite(nextAttemptAtMs) && nextAttemptAtMs > now.getTime()) {
      return false;
    }
  }

  // Recover records written by the old failure policy immediately, even when
  // their access token has not reached the normal provider-specific window.
  if (connection.status === 'error') return true;

  if (!connection.tokenExpiresAt) {
    if (provider !== 'instagram') return false;

    // Instagram Login can temporarily store a short-lived token without an
    // expiry. Meta requires it to be at least 24 hours old before refreshing.
    const updatedAtMs = Date.parse(connection.updatedAt || '');
    return !Number.isFinite(updatedAtMs)
      || now.getTime() - updatedAtMs >= DEFAULT_TOKEN_REFRESH_WINDOW_MS;
  }

  const expiresAtMs = Date.parse(connection.tokenExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;

  return expiresAtMs <= now.getTime() + tokenRefreshWindowMs(provider);
}
