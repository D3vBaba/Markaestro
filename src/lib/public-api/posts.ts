import { adminDb } from '@/lib/firebase-admin';
import type { SocialChannel } from '@/lib/schemas';
import type { PublicApiContext } from './auth';
import { resolveMediaAssetUrls, type ResolvedPublicMediaAsset } from './media';
import type { PublicDeliveryMode } from './scopes';
import { resolvePublicPostDestination } from './products';
import { assertSettingsMatchesChannel, type PostSettings } from './post-settings';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';

type CreatePublicPostInput = {
  channel: SocialChannel;
  caption: string;
  mediaAssetIds: string[];
  scheduledAt?: string | null;
  productId?: string;
  destinationId?: string;
  settings?: PostSettings;
};

export function getDeliveryModeForChannel(channel: SocialChannel): PublicDeliveryMode {
  if (channel === 'tiktok') return 'platform_inbox';
  return 'direct_publish';
}

export function getPublicPostInitialState(scheduledAt?: string | null) {
  void scheduledAt;
  return { status: 'draft' as const, scheduledAt: null };
}

export function validatePublicPostInput(input: CreatePublicPostInput) {
  const count = input.mediaAssetIds.length;
  const config = getSocialChannelConfig(input.channel);

  if (config && count > config.maxMediaItems) {
    throw new Error('VALIDATION_TOO_MANY_MEDIA_ASSETS');
  }

  if (config?.mediaRequired && count < 1) {
    throw new Error(`VALIDATION_${input.channel.toUpperCase()}_REQUIRES_MEDIA`);
  }

  if (input.caption.length > (config?.maxLength ?? 65000)) {
    throw new Error(`VALIDATION_${input.channel.toUpperCase()}_CAPTION_TOO_LONG`);
  }

  switch (input.channel) {
    case 'facebook':
      if (!input.caption && count === 0) {
        throw new Error('VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA');
      }
      break;
  }
}

export function validateResolvedPublicPostInput(
  input: CreatePublicPostInput,
  mediaAssets: ResolvedPublicMediaAsset[],
) {
  const videoCount = mediaAssets.filter((asset) => asset.type === 'video').length;

  if (input.channel === 'pinterest' && videoCount > 0 && mediaAssets.length > 1) {
    throw new Error('VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA');
  }

  if (input.channel !== 'tiktok') {
    return;
  }

  if (videoCount > 1) {
    throw new Error('VALIDATION_TIKTOK_MAX_ONE_VIDEO');
  }

  if (videoCount === 1 && mediaAssets.length > 1) {
    throw new Error('VALIDATION_TIKTOK_VIDEO_CANNOT_BE_COMBINED');
  }
}

export async function createPublicPost(ctx: PublicApiContext, input: CreatePublicPostInput) {
  validatePublicPostInput(input);
  assertSettingsMatchesChannel(input.channel, input.settings);

  // Product-bound keys force their own product: a missing productId defaults to
  // it, and an explicit productId for any other product is rejected.
  let productId = input.productId;
  if (ctx.productId) {
    if (productId && productId !== ctx.productId) {
      throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
    }
    productId = ctx.productId;
  }

  const mediaAssets = await resolveMediaAssetUrls(ctx.workspaceId, input.mediaAssetIds);
  validateResolvedPublicPostInput(input, mediaAssets);
  const resolvedDestination = await resolvePublicPostDestination(
    ctx.workspaceId,
    input.channel,
    productId,
    input.destinationId,
  );
  // External API create is draft-first. Integrations can prepare posts for the
  // right product/destination, and a user or explicit publish call handles the
  // outbound platform action later.
  const initialState = getPublicPostInitialState(input.scheduledAt);
  const now = new Date().toISOString();
  const ref = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`).doc();
  const payload = {
    content: input.caption,
    channel: input.channel,
    status: initialState.status,
    scheduledAt: initialState.scheduledAt,
    mediaUrls: mediaAssets.map((asset) => asset.url),
    mediaAssetIds: input.mediaAssetIds,
    productId: resolvedDestination.productId || '',
    destinationId: resolvedDestination.destinationId,
    destinationProvider: resolvedDestination.destinationProvider,
    deliveryMode: resolvedDestination.deliveryMode || getDeliveryModeForChannel(input.channel),
    willAlsoPublishTo: resolvedDestination.willAlsoPublishTo,
    settings: input.settings ?? null,
    workspaceId: ctx.workspaceId,
    createdBy: ctx.ownerUid ?? ctx.clientId,
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
    settings: post.settings ?? null,
    mediaAssetIds: Array.isArray(post.mediaAssetIds) ? post.mediaAssetIds : [],
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    scheduledAt: post.scheduledAt ?? null,
    externalId: post.externalId || '',
    externalUrl: post.externalUrl || '',
    publishResults: Array.isArray(post.publishResults) ? post.publishResults : [],
    nextAction: post.nextAction || '',
    sourceType: post.sourceType || '',
    slideshowId: post.slideshowId || '',
    slideshowTitle: post.slideshowTitle || '',
    slideshowSlideCount: typeof post.slideshowSlideCount === 'number' ? post.slideshowSlideCount : null,
    slideshowCoverIndex: typeof post.slideshowCoverIndex === 'number' ? post.slideshowCoverIndex : null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}
