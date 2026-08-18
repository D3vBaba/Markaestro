import { describe, expect, it } from 'vitest';
import type { PlatformConnection } from '../platform/types';
import {
  connectionStatusAfterRefreshFailure,
  shouldAttemptScheduledTokenRefresh,
  tokenRefreshRetryDelayMs,
  tokenRefreshWindowMs,
} from '../oauth/token-refresh-policy';

const NOW = new Date('2026-08-18T12:00:00.000Z');

function connection(
  overrides: Partial<Pick<PlatformConnection, 'status' | 'tokenExpiresAt' | 'updatedAt' | 'metadata'>> = {},
) {
  return {
    status: 'connected' as const,
    tokenExpiresAt: '2026-08-19T11:59:00.000Z',
    updatedAt: '2026-08-18T11:59:00.000Z',
    metadata: {},
    ...overrides,
  };
}

describe('scheduled token refresh policy', () => {
  it('uses a one-hour TikTok window instead of refreshing every minute', () => {
    expect(tokenRefreshWindowMs('tiktok')).toBe(60 * 60 * 1000);
    expect(shouldAttemptScheduledTokenRefresh('tiktok', connection(), NOW)).toBe(false);

    expect(shouldAttemptScheduledTokenRefresh('tiktok', connection({
      tokenExpiresAt: '2026-08-18T12:59:00.000Z',
    }), NOW)).toBe(true);
  });

  it('keeps the existing 24-hour window for other providers', () => {
    expect(tokenRefreshWindowMs('pinterest')).toBe(24 * 60 * 60 * 1000);
    expect(shouldAttemptScheduledTokenRefresh('pinterest', connection(), NOW)).toBe(true);
  });

  it('immediately retries legacy error records even with a far-future expiry', () => {
    expect(shouldAttemptScheduledTokenRefresh('tiktok', connection({
      status: 'error',
      metadata: { refreshFailureCount: 5 },
    }), NOW)).toBe(true);
  });

  it('honors a transient-failure backoff before retrying', () => {
    expect(shouldAttemptScheduledTokenRefresh('tiktok', connection({
      status: 'error',
      metadata: { nextRefreshAttemptAt: '2026-08-18T12:05:00.000Z' },
    }), NOW)).toBe(false);
  });

  it('never retries permanently revoked records', () => {
    expect(shouldAttemptScheduledTokenRefresh('tiktok', connection({
      status: 'revoked',
      tokenExpiresAt: '2026-08-18T12:01:00.000Z',
    }), NOW)).toBe(false);
  });
});

describe('token refresh failure recovery', () => {
  it('backs off exponentially but never reaches a permanent stop condition', () => {
    expect(tokenRefreshRetryDelayMs(1)).toBe(60 * 1000);
    expect(tokenRefreshRetryDelayMs(5)).toBe(16 * 60 * 1000);
    expect(tokenRefreshRetryDelayMs(6)).toBe(30 * 60 * 1000);
    expect(tokenRefreshRetryDelayMs(50)).toBe(30 * 60 * 1000);
  });

  it('keeps a connection usable after a transient failure while its token is valid', () => {
    expect(connectionStatusAfterRefreshFailure('2026-08-18T13:00:00.000Z', NOW, false))
      .toBe('connected');
    expect(connectionStatusAfterRefreshFailure('2026-08-18T11:59:00.000Z', NOW, false))
      .toBe('error');
    expect(connectionStatusAfterRefreshFailure('2026-08-18T13:00:00.000Z', NOW, true))
      .toBe('revoked');
  });
});
