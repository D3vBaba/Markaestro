import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { listConnections } from '@/lib/platform/connections';
import {
  deriveAccountKey,
  deriveCredentialKey,
  sanitizeAccountKey,
} from '@/lib/platform/connection-identity';
import { logger } from '@/lib/logger';

/**
 * A connection document about to be created. `accountKey` names a publish
 * destination (Facebook Page, Pinterest board, LinkedIn org, IG/TikTok/Threads
 * account); a null/absent `accountKey` is a bare credential document, which is
 * identified by the account that authorized it instead.
 */
export type ChannelAddition = {
  provider: string;
  accountKey?: string | null;
  credentialKey?: string | null;
};

/**
 * The addition `storeTokens` is about to write for an OAuth grant, derived
 * from the same metadata fields storeTokens itself keys the document by.
 */
export function channelAdditionForGrant(
  provider: string,
  metadata: Record<string, unknown>,
): ChannelAddition {
  return {
    provider,
    accountKey: deriveAccountKey(provider, metadata),
    credentialKey: deriveCredentialKey(provider, metadata),
  };
}

type ChannelEntry = { provider: string; hasDestination: boolean };

function identityOf(
  provider: string,
  accountKey?: string | null,
  credentialKey?: string | null,
): string {
  // Account keys are sanitized before becoming document ids, so sanitize both
  // sides to keep "urn:li:…/x" additions matching their stored documents.
  const key = accountKey
    ? `dest:${sanitizeAccountKey(accountKey)}`
    : `cred:${credentialKey ? sanitizeAccountKey(credentialKey) : ''}`;
  return `${provider}|${key}`;
}

/**
 * How many channels a set of connection documents shows as, matching the
 * deduped display list: every destination counts, and a bare credential
 * counts only while its provider has no destination linked (once one exists,
 * the credential document is superseded in the list).
 */
function countChannels(entries: Iterable<ChannelEntry>): number {
  const all = [...entries];
  const providersWithDestination = new Set(
    all.filter((entry) => entry.hasDestination).map((entry) => entry.provider),
  );
  return all.filter(
    (entry) => entry.hasDestination || !providersWithDestination.has(entry.provider),
  ).length;
}

/**
 * Enforce the per-brand channel cap before persisting new connections.
 *
 * The cap applies per scope: each brand's connections are one bucket, and
 * workspace-scoped connections (no `productId`) are their own bucket under
 * the same cap. Re-authenticating or updating an existing connection is never
 * blocked — the guard simulates the post-write connection list and throws
 * `CHANNEL_LIMIT_REACHED` only when the operation would grow the channel
 * count beyond the plan's `channelsPerBrand` limit. An operation that leaves
 * the count unchanged (or shrinks it, e.g. a picker in replace mode) is
 * always allowed, even for workspaces already over their cap after a
 * downgrade.
 */
export async function assertChannelCapacity(opts: {
  uid?: string;
  workspaceId: string;
  productId?: string;
  additions: ChannelAddition[];
  /**
   * Providers whose destinations are being replaced wholesale (picker
   * 'replace' mode): existing destinations of these providers that are not in
   * `additions` will be unlinked by the caller, so they don't survive into
   * the simulated final state.
   */
  replaceProviders?: string[];
}): Promise<void> {
  const { uid, workspaceId, productId, additions, replaceProviders } = opts;
  if (additions.length === 0) return;

  const limits = await getEffectiveLimits(uid, workspaceId);
  const cap = limits.channelsPerBrand;
  if (cap === -1) return;

  const existing = await listConnections(workspaceId, productId);

  const currentEntries = new Map<string, ChannelEntry>();
  for (const conn of existing) {
    currentEntries.set(identityOf(conn.provider, conn.accountKey, conn.credentialKey), {
      provider: conn.provider,
      hasDestination: Boolean(conn.accountKey),
    });
  }
  const currentCount = countChannels(currentEntries.values());

  const replace = new Set(replaceProviders ?? []);
  const additionIdentities = new Set(
    additions
      .filter((addition) => addition.accountKey)
      .map((addition) => identityOf(addition.provider, addition.accountKey)),
  );

  const finalEntries = new Map<string, ChannelEntry>();
  for (const conn of existing) {
    const identity = identityOf(conn.provider, conn.accountKey, conn.credentialKey);
    // Destinations a replace-mode picker cleared will be unlinked.
    if (replace.has(conn.provider) && conn.accountKey && !additionIdentities.has(identity)) {
      continue;
    }
    finalEntries.set(identity, {
      provider: conn.provider,
      hasDestination: Boolean(conn.accountKey),
    });
  }
  for (const addition of additions) {
    finalEntries.set(identityOf(addition.provider, addition.accountKey, addition.credentialKey), {
      provider: addition.provider,
      hasDestination: Boolean(addition.accountKey),
    });
  }
  const finalCount = countChannels(finalEntries.values());

  if (finalCount <= cap || finalCount <= currentCount) return;

  logger.warn('channel connection blocked by plan limit', {
    event: 'connections.channel_limit_reached',
    workspaceId,
    productId: productId || null,
    tier: limits.tier,
    cap,
    currentCount,
    finalCount,
    providers: [...new Set(additions.map((addition) => addition.provider))],
  });
  throw new Error('CHANNEL_LIMIT_REACHED');
}
