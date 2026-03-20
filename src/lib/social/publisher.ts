import { adminDb } from '@/lib/firebase-admin';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel } from '@/lib/platform/connections';
import type { PublishRequest, PublishResult } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

export type { PublishRequest, PublishResult };

export type ChannelPublishResult = {
  channel: SocialChannel;
  success: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
};

export type MultiChannelPublishResult = {
  /** True if the primary channel succeeded */
  success: boolean;
  /** Results for each channel that was attempted */
  channels: ChannelPublishResult[];
  /** Primary channel external ID (for backwards compat) */
  externalId?: string;
  /** Primary channel external URL (for backwards compat) */
  externalUrl?: string;
  /** Error message if the primary channel failed */
  error?: string;
};

/**
 * Publish a single post to one channel.
 */
export async function publishPost(
  workspaceId: string,
  productId: string | undefined,
  request: PublishRequest,
): Promise<PublishResult> {
  const adapter = getAdapterForChannel(request.channel);
  if (!adapter) {
    return { success: false, error: `Unsupported channel: ${request.channel}` };
  }

  const connection = await getConnectionForChannel(workspaceId, request.channel, productId);
  if (!connection) {
    return { success: false, error: `${request.channel} integration is not configured or disabled` };
  }

  const validationError = adapter.validateConnection(connection, request.channel);
  if (validationError) {
    return { success: false, error: validationError };
  }

  return adapter.publish(connection, request);
}

/**
 * Determine all Meta channels that should be published to.
 * When the user selects facebook or instagram, we auto-include
 * the other channel if the Meta connection supports it.
 */
async function resolveMetaChannels(
  workspaceId: string,
  productId: string | undefined,
  primaryChannel: SocialChannel,
): Promise<SocialChannel[]> {
  if (primaryChannel !== 'facebook' && primaryChannel !== 'instagram') {
    return [primaryChannel];
  }

  const connection = await getConnectionForChannel(workspaceId, primaryChannel, productId);
  if (!connection) return [primaryChannel];

  const hasPage = !!connection.metadata.pageId;
  const hasIg = !!connection.metadata.igAccountId;

  if (hasPage && hasIg) {
    return ['facebook', 'instagram'];
  }

  return [primaryChannel];
}

/**
 * Publish a post to all applicable channels.
 * For Meta (Facebook/Instagram), if both channels are linked, publishes to both.
 * For other channels, publishes to just the selected channel.
 */
export async function publishPostMultiChannel(
  workspaceId: string,
  productId: string | undefined,
  request: PublishRequest,
): Promise<MultiChannelPublishResult> {
  const channels = await resolveMetaChannels(workspaceId, productId, request.channel);

  const results: ChannelPublishResult[] = [];

  for (const channel of channels) {
    // For Instagram, skip if no image (text-only not supported) — don't block the whole publish
    if (channel === 'instagram' && (!request.mediaUrls || request.mediaUrls.length === 0)) {
      results.push({
        channel,
        success: false,
        error: 'Skipped — Instagram requires an image',
      });
      continue;
    }

    const result = await publishPost(workspaceId, productId, {
      ...request,
      channel,
    });

    results.push({
      channel,
      success: result.success,
      ...(result.externalId != null && { externalId: result.externalId }),
      ...(result.externalUrl != null && { externalUrl: result.externalUrl }),
      ...(result.error != null && { error: result.error }),
    });
  }

  // Primary channel result (the channel the user selected)
  const primaryResult = results.find((r) => r.channel === request.channel) || results[0];

  return {
    success: primaryResult.success,
    channels: results,
    externalId: primaryResult.externalId,
    externalUrl: primaryResult.externalUrl,
    error: primaryResult.success ? undefined : primaryResult.error,
  };
}

/**
 * Process all scheduled posts that are due for publishing.
 */
export async function processScheduledPosts(workspaceId: string): Promise<{ processed: number; results: Array<{ postId: string; success: boolean; error?: string }> }> {
  const nowIso = new Date().toISOString();
  const postsRef = adminDb.collection(`workspaces/${workspaceId}/posts`);

  const snap = await postsRef
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', nowIso)
    .limit(50)
    .get();

  const results: Array<{ postId: string; success: boolean; error?: string }> = [];

  for (const doc of snap.docs) {
    const post = doc.data();
    const postId = doc.id;
    const productId = post.productId as string | undefined;

    if (!productId && post.channel !== 'tiktok') {
      results.push({ postId, success: false, error: 'Post has no associated product' });
      continue;
    }

    await doc.ref.update({ status: 'publishing', updatedAt: new Date().toISOString() });

    // Pipeline posts with targetChannels: publish to each channel independently
    const targetChannels = post.targetChannels as SocialChannel[] | undefined;
    let result: MultiChannelPublishResult;

    if (targetChannels && targetChannels.length > 0) {
      const channelResults: ChannelPublishResult[] = [];
      for (const channel of targetChannels) {
        const r = await publishPost(workspaceId, productId, {
          content: post.content,
          channel,
          mediaUrls: post.mediaUrls,
        });
        channelResults.push({
          channel,
          success: r.success,
          externalId: r.externalId,
          externalUrl: r.externalUrl,
          error: r.error,
        });
      }
      const primaryResult = channelResults.find((r) => r.channel === post.channel) || channelResults[0];
      result = {
        success: channelResults.some((r) => r.success),
        channels: channelResults,
        externalId: primaryResult.externalId,
        externalUrl: primaryResult.externalUrl,
        error: channelResults.every((r) => !r.success) ? primaryResult.error : undefined,
      };
    } else {
      result = await publishPostMultiChannel(workspaceId, productId, {
        content: post.content,
        channel: post.channel,
        mediaUrls: post.mediaUrls,
      });
    }

    if (result.success) {
      await doc.ref.update({
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        publishedChannels: result.channels.filter((c) => c.success).map((c) => c.channel),
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await doc.ref.update({
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
        publishResults: result.channels,
        updatedAt: new Date().toISOString(),
      });
    }

    results.push({ postId, success: result.success, error: result.error });
  }

  return { processed: results.length, results };
}
