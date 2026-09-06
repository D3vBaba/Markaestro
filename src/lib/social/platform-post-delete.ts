/**
 * Deleting a post on the platform it lives on.
 *
 * One path for every caller: the in-app Platform Posts tab, the public API
 * (a Markaestro post with `platform=true`, or a post published directly on
 * the platform, which has nothing else to delete), and through it the MCP
 * `delete_post` tool. Resolves the account the post belongs to, calls the
 * channel adapter with one token refresh on an auth failure, and afterwards
 * reconciles what Markaestro knows about the post: the `posts` documents
 * that reference the platform id are stamped `platformDeletedAt`, and the
 * canonical social post is marked deleted and taken off the metrics
 * schedule. Reconciliation is best effort; the platform delete is the
 * outcome that matters, and a miss is logged rather than failed.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel, getLinkedInConnectionForDestination } from '@/lib/platform/connections';
import { refreshConnectionToken } from '@/lib/oauth/token-refresh';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { canDeleteOnPlatform, platformDeleteUnsupportedMessage } from '@/lib/platform/delete-support';
import { canonicalSocialPostId, socialPostAccountKey } from '@/lib/intelligence/canonical-social-posts';
import { oauthProviders, type OAuthProvider, type SocialChannel } from '@/lib/schemas';
import type { PlatformConnection, PlatformRestriction } from '@/lib/platform/types';

export type PlatformFailureReason = 'auth' | 'not_found' | 'unsupported' | 'transient';

export type PlatformDeleteReason = 'not_connected' | PlatformFailureReason;

export type PlatformDeleteResult =
  | { ok: true; connection: PlatformConnection }
  | { ok: false; reason: PlatformDeleteReason; error: string; restriction?: PlatformRestriction };

/** The connected account a channel call should go through, honouring a specific destination. */
export function resolvePlatformConnection(
  workspaceId: string,
  channel: SocialChannel,
  productId?: string,
  destinationId?: string,
): Promise<PlatformConnection | null> {
  if (channel === 'linkedin') {
    return getLinkedInConnectionForDestination(workspaceId, productId, destinationId);
  }
  // A brand can have several accounts linked per channel; honor the one the
  // caller asked for instead of always taking the default.
  return getConnectionForChannel(workspaceId, channel, productId, undefined, destinationId);
}

function isRefreshableProvider(provider: string): provider is OAuthProvider {
  return (oauthProviders as readonly string[]).includes(provider);
}

/**
 * Run a platform call; on an auth failure, refresh the connection's access
 * token once (when a refresh token exists) and retry, mirroring the
 * publisher's refresh-and-retry behavior.
 */
export async function runWithAuthRefresh<T extends { ok: boolean } | { ok: false; reason: PlatformFailureReason }>(
  workspaceId: string,
  connection: PlatformConnection,
  productId: string | undefined,
  call: (conn: PlatformConnection) => Promise<T>,
): Promise<T> {
  const result = await call(connection);
  const failed = result as { ok: boolean; reason?: PlatformFailureReason };
  if (failed.ok || failed.reason !== 'auth') return result;
  if (!connection.refreshTokenEncrypted || !isRefreshableProvider(connection.provider)) return result;

  try {
    const refreshed = await refreshConnectionToken(
      workspaceId,
      connection.provider,
      connection,
      connection.productId ?? productId,
    );
    if (!refreshed) return result;
    return await call(refreshed);
  } catch {
    return result;
  }
}

export type DeletePlatformPostInput = {
  channel: SocialChannel;
  /** The platform's own id for the post. */
  externalId: string;
  productId?: string;
  /** The account to delete through, when the brand has several on the channel. */
  destinationId?: string;
  /** Recorded on the Markaestro posts the delete reconciles. */
  actorUid?: string;
};

/** Delete a post on its platform and, when it went, reconcile Markaestro's records of it. */
export async function deletePlatformPost(
  workspaceId: string,
  input: DeletePlatformPostInput,
): Promise<PlatformDeleteResult> {
  // Instagram and TikTok offer no delete; refused before any lookup or
  // platform call, with the same words the app shows.
  if (!canDeleteOnPlatform(input.channel)) {
    return { ok: false, reason: 'unsupported', error: platformDeleteUnsupportedMessage(input.channel) };
  }
  const adapter = getAdapterForChannel(input.channel);
  if (!adapter?.deletePost) {
    return { ok: false, reason: 'unsupported', error: `${getSocialChannelLabel(input.channel)} does not support deleting posts.` };
  }
  const connection = await resolvePlatformConnection(workspaceId, input.channel, input.productId, input.destinationId);
  if (!connection) {
    return {
      ok: false,
      reason: 'not_connected',
      error: `${getSocialChannelLabel(input.channel)} is not connected. Connect it from brand settings.`,
    };
  }

  const result = await runWithAuthRefresh(workspaceId, connection, input.productId, (conn) =>
    adapter.deletePost!(conn, {
      channel: input.channel,
      externalId: input.externalId,
      destinationId: input.destinationId,
    }),
  );

  if (!result.ok) {
    return { ok: false, reason: result.reason, error: result.error };
  }
  await reconcileDeletedPlatformPost(workspaceId, { ...input, connection });
  return { ok: true, connection };
}

async function reconcileDeletedPlatformPost(
  workspaceId: string,
  input: DeletePlatformPostInput & { connection: PlatformConnection },
): Promise<void> {
  const now = new Date().toISOString();

  // Markaestro posts that reference the platform id, so the metrics poller
  // and the UI can reflect the delete. publishResults-only matches
  // (multi-channel posts) are left to the poller's own not_found handling.
  try {
    const snap = await adminDb
      .collection(`workspaces/${workspaceId}/posts`)
      .where('externalId', '==', input.externalId)
      .limit(20)
      .get();
    await Promise.all(
      snap.docs.map((doc) =>
        doc.ref.update({
          platformDeletedAt: now,
          updatedAt: now,
          ...(input.actorUid ? { updatedBy: input.actorUid } : {}),
        }),
      ),
    );
  } catch (error) {
    // A silent miss leaves the metrics poller chasing a post that no longer
    // exists on the platform, so it is logged rather than swallowed.
    logger.warn('post reconciliation after platform delete failed', {
      event: 'social.post_delete_reconcile_failed',
      workspaceId,
      channel: input.channel,
      externalId: input.externalId,
      err: error,
    });
  }

  // The canonical social post (a native post, or the projection of a
  // Markaestro one): marked deleted and taken off the metrics schedule. An
  // update, not a merge, so a post no canonical record exists for never
  // gains a stub.
  try {
    const id = canonicalSocialPostId(input.channel, socialPostAccountKey(input.connection), input.externalId);
    await adminDb.doc(`workspaces/${workspaceId}/socialPosts/${id}`).update({
      deletedAt: now,
      metricsStatus: 'unsupported',
      metricsLastError: 'Deleted on the platform',
      metricsNextPollAt: FieldValue.delete(),
      updatedAt: now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No canonical record is the common case for an older Markaestro post.
    if (!/NOT_FOUND|no document to update/i.test(message)) {
      logger.warn('canonical social post reconciliation after platform delete failed', {
        event: 'social.post_delete_canonical_reconcile_failed',
        workspaceId,
        channel: input.channel,
        externalId: input.externalId,
        err: error,
      });
    }
  }
}
