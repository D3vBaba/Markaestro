import { adminDb } from '@/lib/firebase-admin';
import type { SocialChannel } from '@/lib/schemas';
import type { PublicApiContext } from './auth';
import { resolveMediaAssetUrls, type ResolvedPublicMediaAsset } from './media';
import type { PublicDeliveryMode } from './scopes';
import { resolvePublicPostDestination, type ResolvedPublicDestination } from './products';
import { assertSettingsMatchesChannel, isTikTokDirectPostSettings, type PostSettings } from './post-settings';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
import { isManualReminderDeliveryMode, MANUAL_REMINDER_DELIVERY_MODE } from '@/lib/manual-publish-flow';

type CreatePublicPostInput = {
  channel: SocialChannel;
  caption: string;
  mediaAssetIds: string[];
  scheduledAt?: string | null;
  productId?: string;
  destinationId?: string;
  deliveryMode?: PublicDeliveryMode;
  settings?: PostSettings;
};

// Meta + TikTok posts created through the public API default to manual
// reminder: the server never calls those platform APIs unless the client
// explicitly opts into direct publishing per post.
const MANUAL_REMINDER_DEFAULT_CHANNELS = new Set<SocialChannel>(['facebook', 'instagram', 'tiktok']);

export function getDeliveryModeForChannel(channel: SocialChannel): PublicDeliveryMode {
  if (MANUAL_REMINDER_DEFAULT_CHANNELS.has(channel)) return MANUAL_REMINDER_DELIVERY_MODE;
  return 'direct_publish';
}

export function resolveRequestedDeliveryMode(
  channel: SocialChannel,
  requested?: PublicDeliveryMode,
  settings?: PostSettings,
): PublicDeliveryMode {
  if (!requested) return getDeliveryModeForChannel(channel);
  if (requested === 'platform_inbox' && channel !== 'tiktok') {
    throw new Error('VALIDATION_DELIVERY_MODE_NOT_SUPPORTED_FOR_CHANNEL');
  }
  // TikTok has two API-publishing paths. Direct Post (`settings.postMode`)
  // genuinely publishes to the profile, so it keeps `direct_publish`; without
  // it the only path is the inbox hand-off, which an explicit direct-publish
  // opt-in maps onto.
  if (requested === 'direct_publish' && channel === 'tiktok') {
    return isTikTokDirectPostSettings(settings) ? 'direct_publish' : 'platform_inbox';
  }
  return requested;
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
    case 'linkedin':
      if (!input.caption.trim()) {
        throw new Error('VALIDATION_LINKEDIN_POST_REQUIRES_CONTENT');
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

  if (input.channel === 'linkedin' && videoCount > 0 && mediaAssets.length > 1) {
    throw new Error('VALIDATION_LINKEDIN_VIDEO_MUST_BE_SINGLE_MEDIA');
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
  const deliveryMode = resolveRequestedDeliveryMode(input.channel, input.deliveryMode, input.settings);

  // Manual reminder posts don't need a connected platform account — nothing is
  // ever sent to the platform. Resolve the destination best-effort so posts
  // still attach to the right product/account when one is connected, but treat
  // "no destination configured" as fine instead of an error.
  let resolvedDestination: ResolvedPublicDestination | null;
  if (isManualReminderDeliveryMode(deliveryMode)) {
    resolvedDestination = await resolvePublicPostDestination(
      ctx.workspaceId,
      input.channel,
      productId,
      input.destinationId,
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const missingDestination =
        message.startsWith('VALIDATION_DESTINATION') ||
        message.startsWith('VALIDATION_PRODUCT_ID_REQUIRED');
      if (!missingDestination) throw error;
      return null;
    });
  } else {
    resolvedDestination = await resolvePublicPostDestination(
      ctx.workspaceId,
      input.channel,
      productId,
      input.destinationId,
    );
  }

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
    productId: resolvedDestination?.productId || productId || '',
    destinationId: resolvedDestination?.destinationId || '',
    destinationProvider: resolvedDestination?.destinationProvider || '',
    deliveryMode: isManualReminderDeliveryMode(deliveryMode)
      ? deliveryMode
      : resolvedDestination?.deliveryMode || deliveryMode,
    willAlsoPublishTo: resolvedDestination?.willAlsoPublishTo ?? [],
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

/**
 * Resolve which brand (productId) a list query should be scoped to.
 *
 * A brand-bound key is hard-scoped to its own brand: it may omit the filter or
 * name its own brand, but asking for another brand is forbidden. An unbound
 * workspace key may filter by any brand, or omit it to list every brand.
 */
export function resolvePublicPostBrandScope(
  keyProductId?: string,
  requestedProductId?: string,
): string | undefined {
  if (!keyProductId) return requestedProductId || undefined;
  if (requestedProductId && requestedProductId !== keyProductId) {
    throw new Error('FORBIDDEN');
  }
  return keyProductId;
}

/**
 * A brand-bound key must not read or mutate another brand's post. Reported as
 * NOT_FOUND rather than FORBIDDEN so a key cannot probe for post ids that
 * exist outside its brand.
 */
export function assertPublicPostInBrandScope(
  post: Record<string, unknown>,
  keyProductId?: string,
) {
  if (!keyProductId) return;
  if (post.productId !== keyProductId) throw new Error('NOT_FOUND');
}

/**
 * A post already handed to the publisher must not be deleted out from under
 * it — the run would keep going and could publish, leaving a live post with
 * no record. Callers should cancel or wait for it to settle first.
 */
export function assertPublicPostDeletable(post: Record<string, unknown>) {
  if (post.status === 'publishing') throw new Error('VALIDATION_POST_IS_PUBLISHING');
}

export async function deletePublicPost(workspaceId: string, postId: string) {
  await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).delete();
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
    deliveryMode: post.deliveryMode || '',
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
