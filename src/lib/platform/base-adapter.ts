import { decrypt } from '@/lib/crypto';
import type { NormalizedPostMetrics, PlatformConnection } from './types';

/**
 * Decrypt the access token from a PlatformConnection.
 * Shared utility used by all adapters.
 */
export function getAccessToken(connection: PlatformConnection): string {
  return decrypt(connection.accessTokenEncrypted);
}

/**
 * Get a metadata value from the connection with a fallback.
 */
export function getMeta<T>(connection: PlatformConnection, key: string, fallback: T): T {
  const val = connection.metadata[key];
  return (val as T) ?? fallback;
}

/**
 * All-null metrics skeleton. Adapters fill in only what the platform
 * actually returned; a metric left null renders as "unavailable", never 0.
 */
export function emptyMetrics(): NormalizedPostMetrics {
  return {
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    videoViews: null,
    raw: {},
  };
}

/** Coerce an API value to a finite number, else null (no fake zeros). */
export function metricNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
