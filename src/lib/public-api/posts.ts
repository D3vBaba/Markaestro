import { adminDb } from '@/lib/firebase-admin';
import type { SocialChannel } from '@/lib/schemas';
import type { PublicApiContext } from './auth';
import { resolveMediaAssetUrls } from './media';
import type { PublicDeliveryMode } from './scopes';
import { resolvePublicPostDestination } from './products';

type CreatePublicPostInput = {
  channel: SocialChannel;
  caption: string;
  mediaAssetIds: string[];
  scheduledAt?: string | null;
  productId?: string;
  destinationId?: string;
};

export function getDeliveryModeForChannel(channel: SocialChannel): PublicDeliveryMode {
  return channel === 'tiktok' ? 'user_review' : 'direct_publish';
}

export function validatePublicPostInput(input: CreatePublicPostInput) {
  const count = input.mediaAssetIds.length;

  if (count > 10) {
    throw new Error('VALIDATION_TOO_MANY_MEDIA_ASSETS');
  }

  switch (input.channel) {
    case 'facebook':
      if (!input.caption && count === 0) {
        throw new Error('VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA');
      }
      break;
    case 'instagram':
      if (count < 1) {
        throw new Error('VALIDATION_INSTAGRAM_REQUIRES_IMAGE');
      }
      break;
    case 'tiktok':
      if (count < 1) {
        throw new Error('VALIDATION_TIKTOK_REQUIRES_IMAGE');
      }
      break;
  }
}

export async function createPublicPost(ctx: PublicApiContext, input: CreatePublicPostInput) {
  validatePublicPostInput(input);

  const mediaAssets = await resolveMediaAssetUrls(ctx.workspaceId, input.mediaAssetIds);
  const resolvedDestination = await resolvePublicPostDestination(
    ctx.workspaceId,
    input.channel,
    input.productId,
    input.destinationId,
  );
  const now = new Date().toISOString();
  const ref = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`).doc();
  const status = input.scheduledAt ? 'scheduled' : 'draft';
  const payload = {
    content: input.caption,
    channel: input.channel,
    status,
    scheduledAt: input.scheduledAt || null,
    mediaUrls: mediaAssets.map((asset) => asset.url),
    mediaAssetIds: input.mediaAssetIds,
    productId: resolvedDestination.productId || '',
    destinationId: resolvedDestination.destinationId,
    destinationProvider: resolvedDestination.destinationProvider,
    deliveryMode: resolvedDestination.deliveryMode || getDeliveryModeForChannel(input.channel),
    willAlsoPublishTo: resolvedDestination.willAlsoPublishTo,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt: now,
    updatedAt: now,
    externalId: '',
    externalUrl: '',
    errorMessage: '',
    publishResults: [],
  };

  await ref.set(payload);
  return { id: ref.id, ...payload };
}

export async function getPublicPost(workspaceId: string, postId: string): Promise<{ id: string } & Record<string, unknown>> {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

export function serializePublicPost(post: Record<string, unknown>) {
  return {
    id: String(post.id),
    channel: post.channel,
    status: post.status,
    caption: post.content || '',
    productId: post.productId || '',
    destinationId: post.destinationId || '',
    destinationProvider: post.destinationProvider || '',
    mediaAssetIds: Array.isArray(post.mediaAssetIds) ? post.mediaAssetIds : [],
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    scheduledAt: post.scheduledAt ?? null,
    externalId: post.externalId || '',
    externalUrl: post.externalUrl || '',
    publishResults: Array.isArray(post.publishResults) ? post.publishResults : [],
    nextAction: post.nextAction || '',
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}
