import { logger } from '@/lib/logger';
import { refreshConnectionToken } from '@/lib/oauth/token-refresh';
import type { PlatformConnection } from '@/lib/platform/types';

// TikTok access tokens are short-lived. Refresh just before use so a post
// handoff or status poll does not fail on a stale token.
const TIKTOK_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function isTikTokTokenExpiringSoon(connection: PlatformConnection): boolean {
  if (!connection.tokenExpiresAt) return false;
  return new Date(connection.tokenExpiresAt).getTime() <= Date.now() + TIKTOK_TOKEN_REFRESH_BUFFER_MS;
}

export function isTikTokTokenInvalid(error?: string): boolean {
  return !!error && /access_token_invalid/i.test(error);
}

export async function refreshTikTokConnection(
  workspaceId: string,
  productId: string | undefined,
  connection: PlatformConnection,
): Promise<PlatformConnection | null> {
  try {
    return await refreshConnectionToken(
      workspaceId,
      'tiktok',
      connection,
      connection.productId ?? productId,
    );
  } catch (error) {
    logger.warn('tiktok token refresh failed', {
      event: 'tiktok.token_refresh_failed',
      workspaceId,
      productId: connection.productId ?? productId ?? null,
      err: error,
    });
    return null;
  }
}
