import { decrypt } from '@/lib/crypto';
import type { PlatformConnection } from './types';

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
