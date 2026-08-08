import type { PlatformConnection } from './types';

/**
 * Connection documents used to be keyed by provider alone, which gave every
 * (brand, provider) pair exactly one slot — so a Facebook account managing ten
 * Pages collapsed into a single connection and only one Page was ever usable.
 *
 * A connection is now identified by provider *and* the destination it publishes
 * to: `${provider}:${accountKey}`. A document whose id is the bare provider is
 * either a legacy single-slot connection (read for backward compatibility and
 * migrated on the next write) or, at workspace scope, a pure credential such as
 * the Meta app-user token, which owns no destination of its own.
 */
export const CONNECTION_ID_SEPARATOR = ':';

/** Firestore caps document ids at 1500 bytes; stay far below that. */
const MAX_ACCOUNT_KEY_LENGTH = 256;

function readString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(metadata, key);
    if (value) return value;
  }
  return null;
}

/**
 * Make an external id safe as a Firestore document id segment. Slashes are the
 * only character Firestore forbids outright; the length cap keeps LinkedIn URNs
 * and similar long ids well inside the limit.
 */
export function sanitizeAccountKey(accountKey: string): string {
  return accountKey.trim().replace(/\//g, '_').slice(0, MAX_ACCOUNT_KEY_LENGTH);
}

/**
 * Build the document id for a connection. Without an account key this returns
 * the bare provider — the pending/credential document.
 */
export function buildConnectionId(provider: string, accountKey?: string | null): string {
  const key = typeof accountKey === 'string' ? sanitizeAccountKey(accountKey) : '';
  return key ? `${provider}${CONNECTION_ID_SEPARATOR}${key}` : provider;
}

/** True when `connectionId` addresses a destination rather than a bare credential. */
export function isAccountScopedConnectionId(provider: string, connectionId: string): boolean {
  return connectionId.startsWith(`${provider}${CONNECTION_ID_SEPARATOR}`);
}

/**
 * The external destination a connection publishes to: the Facebook Page, the
 * Instagram/Threads/TikTok account, the Pinterest board, the LinkedIn profile
 * or organization. Null while a destination has not been picked yet.
 */
export function deriveAccountKey(
  provider: string,
  metadata: Record<string, unknown> | undefined,
): string | null {
  switch (provider) {
    case 'meta':
      return firstString(metadata, ['pageId']);
    case 'instagram':
      return firstString(metadata, ['igAccountId']);
    case 'threads':
      return firstString(metadata, ['threadsUserId']);
    case 'tiktok':
      return firstString(metadata, ['openId', 'unionId']);
    case 'pinterest':
      return firstString(metadata, ['boardId']);
    case 'linkedin':
    case 'linkedin_profile':
    case 'linkedin_community':
      return firstString(metadata, ['linkedinDestinationUrn']);
    default:
      return null;
  }
}

/**
 * The account that authorized the grant, which is not always the account being
 * published to: one Facebook login covers many Pages, one Pinterest login many
 * boards, one LinkedIn login many organizations. Keying the pending grant by
 * this means connecting a second account adds a credential instead of
 * overwriting the first one's.
 */
export function deriveCredentialKey(
  provider: string,
  metadata: Record<string, unknown> | undefined,
): string | null {
  switch (provider) {
    case 'meta':
      return firstString(metadata, ['metaUserId']);
    case 'pinterest':
      // Pinterest usernames are unique per account and always present, so they
      // stand in when /user_account omits the numeric id.
      return firstString(metadata, ['pinterestUserId', 'username']);
    case 'linkedin_profile':
      return firstString(metadata, ['linkedinProfileId']);
    case 'linkedin_community':
      return firstString(metadata, ['linkedinAuthorizingProfileId', 'linkedinProfileId']);
    case 'linkedin':
      return firstString(metadata, ['linkedinProfileId', 'linkedinAuthorizingProfileId']);
    default:
      // Instagram/Threads/TikTok authorize exactly the account they publish to.
      return deriveAccountKey(provider, metadata);
  }
}

/** Credential key for a stored connection, preferring the persisted field. */
export function connectionCredentialKey(connection: PlatformConnection): string | null {
  if (typeof connection.credentialKey === 'string' && connection.credentialKey.trim()) {
    return connection.credentialKey.trim();
  }
  return deriveCredentialKey(connection.provider, connection.metadata);
}

/** Human-readable name for the destination, shown in pickers and channel tiles. */
export function deriveAccountLabel(
  provider: string,
  metadata: Record<string, unknown> | undefined,
): string | null {
  switch (provider) {
    case 'meta':
      return firstString(metadata, ['pageName']);
    case 'pinterest':
      return firstString(metadata, ['boardName']);
    case 'linkedin':
    case 'linkedin_profile':
    case 'linkedin_community':
      return firstString(metadata, ['linkedinDestinationName']);
    default:
      return firstString(metadata, ['username', 'displayName']);
  }
}

/**
 * Account key for a stored connection, preferring the persisted field and
 * falling back to metadata so legacy documents resolve without a migration.
 */
export function connectionAccountKey(connection: PlatformConnection): string | null {
  if (typeof connection.accountKey === 'string' && connection.accountKey.trim()) {
    return connection.accountKey.trim();
  }
  return deriveAccountKey(connection.provider, connection.metadata);
}

export function connectionAccountLabel(connection: PlatformConnection): string | null {
  if (typeof connection.accountLabel === 'string' && connection.accountLabel.trim()) {
    return connection.accountLabel.trim();
  }
  return deriveAccountLabel(connection.provider, connection.metadata);
}

/**
 * Stable identity for a connection, used to dedupe legacy and account-scoped
 * docs. A grant with no destination yet is identified by the account that
 * authorized it, so two pending logins never collapse into one.
 */
export function connectionIdentityKey(connection: PlatformConnection): string {
  const key = connectionAccountKey(connection) ?? connectionCredentialKey(connection) ?? '';
  return `${connection.provider}${CONNECTION_ID_SEPARATOR}${key}`;
}

/**
 * Channel segment of the public API's `${provider}:${channel}:${accountId}`
 * destination id. Kept local so this module stays free of schema imports.
 */
const PUBLIC_DESTINATION_CHANNELS = new Set([
  'facebook',
  'instagram',
  'tiktok',
  'threads',
  'pinterest',
  'linkedin',
]);

const PUBLIC_DESTINATION_PROVIDERS = new Set([
  'meta',
  'instagram',
  'tiktok',
  'threads',
  'pinterest',
  'linkedin',
  'linkedin_profile',
  'linkedin_community',
]);

/**
 * Destination ids reach us in several shapes. The public API mints
 * `${provider}:${channel}:${accountId}` (`meta:facebook:123`), the composer
 * stores the bare account id, and LinkedIn adds URNs plus a legacy
 * `linkedin:linkedin:{id}` form. Reduce all of them to the account id.
 *
 * A URN such as `urn:li:organization:99` is deliberately left intact: `urn` is
 * not a provider key, so it is never mistaken for the public form.
 */
export function normalizeDestinationId(destinationId: string): string {
  const parts = destinationId.split(CONNECTION_ID_SEPARATOR);
  if (
    parts.length >= 3 &&
    PUBLIC_DESTINATION_PROVIDERS.has(parts[0]) &&
    PUBLIC_DESTINATION_CHANNELS.has(parts[1])
  ) {
    return parts.slice(2).join(CONNECTION_ID_SEPARATOR);
  }
  return destinationId;
}

/** Whether a connection publishes to the requested destination. */
export function connectionMatchesDestination(
  connection: PlatformConnection,
  destinationId: string,
): boolean {
  const requested = normalizeDestinationId(destinationId);
  const accountKey = connectionAccountKey(connection);
  if (accountKey && (accountKey === requested || accountKey === destinationId)) return true;

  // LinkedIn callers may address an organization by its bare id while the
  // connection stores the full URN.
  const urn = readString(connection.metadata, 'linkedinDestinationUrn');
  const accountId = readString(connection.metadata, 'linkedinDestinationAccountId');
  return Boolean((urn && urn === requested) || (accountId && accountId === requested));
}
