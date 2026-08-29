import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { socialChannels, oauthProviders, type OAuthProvider, type SocialChannel } from '@/lib/schemas';
import { getAdapterForChannel } from '@/lib/platform/registry';
import {
  getConnectionForChannel,
  getLinkedInConnectionForDestination,
} from '@/lib/platform/connections';
import { refreshConnectionToken } from '@/lib/oauth/token-refresh';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import type { PlatformConnection, PlatformRestriction } from '@/lib/platform/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const listQuerySchema = z.object({
  channel: z.enum(socialChannels),
  productId: z.string().optional(),
  destinationId: z.string().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const deleteQuerySchema = z.object({
  channel: z.enum(socialChannels),
  externalId: z.string().min(1).max(500),
  productId: z.string().optional(),
  destinationId: z.string().optional(),
});

type FailureReason = 'auth' | 'not_found' | 'unsupported' | 'transient';

const FAILURE_STATUS: Record<FailureReason, number> = {
  auth: 409,
  not_found: 404,
  unsupported: 400,
  transient: 502,
};

const FAILURE_CODE: Record<FailureReason, string> = {
  auth: 'CONNECTION_AUTH_ERROR',
  not_found: 'PLATFORM_POST_NOT_FOUND',
  unsupported: 'UNSUPPORTED',
  transient: 'PLATFORM_ERROR',
};

function failureResponse(reason: FailureReason, message: string, restriction?: PlatformRestriction) {
  return apiOk(
    {
      error: FAILURE_CODE[reason],
      reason,
      // Named platform restrictions travel as their own field so the UI can
      // explain a permanent refusal without re-parsing the platform's prose.
      ...(restriction ? { restriction } : {}),
      message: reason === 'auth'
        ? `${message}. Reconnect the account from brand settings.`
        : message,
    },
    FAILURE_STATUS[reason],
  );
}

function resolveConnection(
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
 * token once (when a refresh token exists) and retry — mirrors the
 * publisher's refresh-and-retry behavior.
 */
async function runWithAuthRefresh<T extends { ok: boolean } | { ok: false; reason: FailureReason }>(
  workspaceId: string,
  connection: PlatformConnection,
  productId: string | undefined,
  call: (conn: PlatformConnection) => Promise<T>,
): Promise<T> {
  const result = await call(connection);
  const failed = result as { ok: boolean; reason?: FailureReason };
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

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const url = new URL(req.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));

    const adapter = getAdapterForChannel(query.channel);
    if (!adapter?.listPosts) {
      return failureResponse('unsupported', `${getSocialChannelLabel(query.channel)} does not support listing posts.`);
    }

    const connection = await resolveConnection(ctx.workspaceId, query.channel, query.productId, query.destinationId);
    if (!connection) {
      return apiOk(
        {
          error: 'NOT_CONNECTED',
          reason: 'not_connected',
          message: `${getSocialChannelLabel(query.channel)} is not connected. Connect it from brand settings.`,
        },
        400,
      );
    }

    const result = await runWithAuthRefresh(ctx.workspaceId, connection, query.productId, (conn) =>
      adapter.listPosts!(conn, {
        channel: query.channel,
        cursor: query.cursor,
        limit: query.limit,
        destinationId: query.destinationId,
      }),
    );

    if (!result.ok) {
      return failureResponse(result.reason, result.error, result.restriction);
    }

    return apiOk({
      channel: query.channel,
      posts: result.posts,
      nextCursor: result.nextCursor ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');
    const url = new URL(req.url);
    const query = deleteQuerySchema.parse(Object.fromEntries(url.searchParams));

    const adapter = getAdapterForChannel(query.channel);
    if (!adapter?.deletePost) {
      return failureResponse('unsupported', `${getSocialChannelLabel(query.channel)} does not support deleting posts.`);
    }

    const connection = await resolveConnection(ctx.workspaceId, query.channel, query.productId, query.destinationId);
    if (!connection) {
      return apiOk(
        {
          error: 'NOT_CONNECTED',
          reason: 'not_connected',
          message: `${getSocialChannelLabel(query.channel)} is not connected. Connect it from brand settings.`,
        },
        400,
      );
    }

    const result = await runWithAuthRefresh(ctx.workspaceId, connection, query.productId, (conn) =>
      adapter.deletePost!(conn, {
        channel: query.channel,
        externalId: query.externalId,
        destinationId: query.destinationId,
      }),
    );

    if (!result.ok) {
      return failureResponse(result.reason, result.error);
    }

    // Best-effort reconciliation: stamp app post records that reference the
    // deleted platform post so the metrics poller and UI can reflect it.
    // publishResults-only matches (multi-channel posts) are left to the
    // poller's own not_found handling.
    try {
      const snap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/posts`)
        .where('externalId', '==', query.externalId)
        .limit(20)
        .get();
      const now = new Date().toISOString();
      await Promise.all(
        snap.docs.map((doc) =>
          doc.ref.update({
            platformDeletedAt: now,
            updatedAt: now,
            updatedBy: ctx.uid,
          }),
        ),
      );
    } catch (reconcileError) {
      // Was a bare console.warn, which produced neither a structured Cloud
      // Logging entry nor a Sentry breadcrumb, unlike every other warning
      // path here. A silent miss leaves the metrics poller chasing a post
      // that no longer exists on the platform.
      logger.warn('post reconciliation after platform delete failed', {
        event: 'social.post_delete_reconcile_failed',
        workspaceId: ctx.workspaceId,
        channel: query.channel,
        externalId: query.externalId,
        err: reconcileError,
      });
    }

    return apiOk({ ok: true, channel: query.channel, externalId: query.externalId });
  } catch (error) {
    return apiError(error);
  }
}
