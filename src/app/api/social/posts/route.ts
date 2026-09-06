import { z } from 'zod';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { socialChannels } from '@/lib/schemas';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';
import {
  deletePlatformPost,
  resolvePlatformConnection,
  runWithAuthRefresh,
  type PlatformFailureReason,
} from '@/lib/social/platform-post-delete';
import type { PlatformRestriction } from '@/lib/platform/types';

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

type FailureReason = PlatformFailureReason;

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

    const connection = await resolvePlatformConnection(ctx.workspaceId, query.channel, query.productId, query.destinationId);
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

    const result = await deletePlatformPost(ctx.workspaceId, {
      channel: query.channel,
      externalId: query.externalId,
      productId: query.productId,
      destinationId: query.destinationId,
      actorUid: ctx.uid,
    });

    if (!result.ok) {
      if (result.reason === 'not_connected') {
        return apiOk({ error: 'NOT_CONNECTED', reason: 'not_connected', message: result.error }, 400);
      }
      return failureResponse(result.reason, result.error);
    }

    return apiOk({ ok: true, channel: query.channel, externalId: query.externalId });
  } catch (error) {
    return apiError(error);
  }
}
