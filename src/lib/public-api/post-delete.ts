/**
 * `DELETE /api/public/v1/posts/{id}` for every kind of post an agent can name.
 *
 * The id may be a Markaestro post or a post published directly on the
 * platform (the analytics endpoints hand out both kinds). A Markaestro post
 * loses its record; with `platform=true` a published one is first removed
 * from every channel it went to, and the record goes only once every live
 * copy is gone, so a failed retraction leaves something to retry from. A
 * native post has no record to remove, so deleting it always means the
 * platform. Removing a live post needs the `posts.publish` scope, the same
 * bar as putting one up.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk } from '@/lib/api-response';
import { isNativePostDoc, type NativeSocialPostDoc } from '@/lib/analytics/native-posts';
import { POST_ID_PATTERN } from '@/lib/analytics/post-history';
import { publishedChannelTargets } from '@/lib/intelligence/publish-targets';
import { getPostChannelDestinations } from '@/lib/social/publisher';
import { deletePlatformPost, type PlatformDeleteResult } from '@/lib/social/platform-post-delete';
import type { SocialChannel } from '@/lib/schemas';
import { hasPublicApiScope, type PublicApiContext } from './auth';
import { assertPublicPostDeletable, assertPublicPostInBrandScope, deletePublicPost } from './posts';

export type PublicPostDeleteBody = {
  deleted: true;
  id: string;
  /** `markaestro` for a Markaestro post; `native` for one published directly on the platform. */
  source: 'markaestro' | 'native';
  /** The channels the live copy was removed from; false when only the record went. */
  platform: { channels: SocialChannel[] } | false;
};

/** `platform=true` or `platform=1` on the query string asks for the live copy to go too. */
export function parsePlatformFlag(value: string | null): boolean {
  return value === 'true' || value === '1';
}

type DeletePrincipal = Pick<PublicApiContext, 'workspaceId' | 'productId' | 'scopes'>;

function assertPlatformDeleteScope(ctx: DeletePrincipal): void {
  if (hasPublicApiScope(ctx.scopes, 'posts.publish')) return;
  throw apiOk(
    {
      error: 'FORBIDDEN',
      message: 'Removing a live post from its platform needs the posts.publish scope.',
      requiredScope: 'posts.publish',
    },
    403,
  );
}

const FAILURE_STATUS = { not_connected: 400, auth: 409, not_found: 404, unsupported: 400, transient: 502 } as const;
const FAILURE_CODE = {
  not_connected: 'NOT_CONNECTED',
  auth: 'CONNECTION_AUTH_ERROR',
  not_found: 'PLATFORM_POST_NOT_FOUND',
  unsupported: 'UNSUPPORTED',
  transient: 'PLATFORM_ERROR',
} as const;

/** The same codes and statuses the in-app platform delete answers with, plus which channel failed. */
function platformFailure(
  result: Extract<PlatformDeleteResult, { ok: false }>,
  channel: SocialChannel,
  removedChannels: SocialChannel[],
): Response {
  return apiOk(
    {
      error: FAILURE_CODE[result.reason],
      reason: result.reason,
      channel,
      ...(result.restriction ? { restriction: result.restriction } : {}),
      // What already went, so a caller retrying a multi-channel post knows
      // the record is still there because of this channel alone.
      removedChannels,
      message: result.reason === 'auth' ? `${result.error}. Reconnect the account.` : result.error,
    },
    FAILURE_STATUS[result.reason],
  );
}

async function markNativeDeleted(ref: FirebaseFirestore.DocumentReference, nowIso: string): Promise<void> {
  await ref.update({
    deletedAt: nowIso,
    metricsStatus: 'unsupported',
    metricsLastError: 'Deleted on the platform',
    metricsNextPollAt: FieldValue.delete(),
    updatedAt: nowIso,
  });
}

export async function deletePublicPostById(
  ctx: DeletePrincipal,
  id: string,
  opts: { platform: boolean },
): Promise<PublicPostDeleteBody> {
  if (!POST_ID_PATTERN.test(id)) throw new Error('NOT_FOUND');
  const keyProductId = ctx.productId ?? undefined;

  const postSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`).get();
  if (postSnap.exists) {
    const post: Record<string, unknown> = { ...(postSnap.data() as Record<string, unknown>), id };
    assertPublicPostInBrandScope(post, keyProductId);
    assertPublicPostDeletable(post);

    const removed: SocialChannel[] = [];
    if (opts.platform && post.status === 'published') {
      assertPlatformDeleteScope(ctx);
      const destinations = getPostChannelDestinations(post);
      const productId = typeof post.productId === 'string' ? post.productId : undefined;
      const targets = publishedChannelTargets(post as {
        channel?: string;
        externalId?: string;
        publishResults?: Array<{ channel?: string; success?: boolean; externalId?: string }>;
      });
      for (const target of targets) {
        const result = await deletePlatformPost(ctx.workspaceId, {
          channel: target.channel,
          externalId: target.externalId,
          productId,
          destinationId: destinations[target.channel] ?? (typeof post.destinationId === 'string' ? post.destinationId : undefined),
        });
        // Already gone from the platform is the outcome asked for.
        if (!result.ok && result.reason !== 'not_found') throw platformFailure(result, target.channel, removed);
        removed.push(target.channel);
      }
    }

    await deletePublicPost(ctx.workspaceId, id);
    return { deleted: true, id, source: 'markaestro', platform: removed.length > 0 ? { channels: removed } : false };
  }

  const nativeRef = adminDb.doc(`workspaces/${ctx.workspaceId}/socialPosts/${id}`);
  const nativeSnap = await nativeRef.get();
  const native = nativeSnap.exists ? (nativeSnap.data() as NativeSocialPostDoc) : undefined;
  if (!native || !isNativePostDoc(native) || native.deletedAt) throw new Error('NOT_FOUND');
  assertPublicPostInBrandScope(native as Record<string, unknown>, keyProductId);
  assertPlatformDeleteScope(ctx);

  const channel = native.platform as SocialChannel;
  const nowIso = new Date().toISOString();
  const result = await deletePlatformPost(ctx.workspaceId, {
    channel,
    externalId: native.externalId,
    productId: typeof native.productId === 'string' ? native.productId : undefined,
    destinationId: native.accountKey,
  });
  if (!result.ok) {
    // Gone before we got there: stop tracking it, and say so with a 404.
    if (result.reason === 'not_found') await markNativeDeleted(nativeRef, nowIso);
    throw platformFailure(result, channel, []);
  }
  // The delete helper reconciles by canonical id; this is the same document,
  // written directly so the outcome never depends on the id derivation.
  await markNativeDeleted(nativeRef, nowIso);
  return { deleted: true, id, source: 'native', platform: { channels: [channel] } };
}
