import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel } from '@/lib/platform/connections';
import type { PublishRequest, PublishResult } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

export type { PublishRequest, PublishResult };

const MAX_DUE_POSTS_PER_RUN = 50;
const MAX_RECOVERIES_PER_RUN = 50;
const PUBLISH_LEASE_MS = 10 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

export type ChannelPublishResult = {
  channel: SocialChannel;
  success: boolean;
  pending?: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
};

export type MultiChannelPublishResult = {
  /** True only when all required channels have completed successfully */
  success: boolean;
  /** True when one or more channels are still processing asynchronously */
  pending?: boolean;
  /** Results for each channel that was attempted */
  channels: ChannelPublishResult[];
  /** Primary channel external ID (for backwards compat) */
  externalId?: string;
  /** Primary channel external URL (for backwards compat) */
  externalUrl?: string;
  /** Error message if the publish did not complete successfully */
  error?: string;
};

type PublishErrorClassification = {
  code: string;
  category: 'transient' | 'permanent';
  retryable: boolean;
};

type ClaimedScheduledPost = {
  postId: string;
  productId?: string;
  post: Record<string, unknown>;
  attemptId: string;
  attemptCount: number;
};

export type ScheduledPostsProcessResult = {
  claimed: number;
  processed: number;
  published: number;
  pending: number;
  retried: number;
  failed: number;
  recovered: number;
  results: Array<{ postId: string; outcome: 'published' | 'pending' | 'retried' | 'failed' | 'recovered'; error?: string }>;
  errors: Array<{ postId: string; error: string }>;
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

function classifyPublishError(error: string): PublishErrorClassification {
  const normalized = error.toLowerCase();

  const transientPatterns: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /\b429\b|rate limit|too many requests/, code: 'RATE_LIMITED' },
    { pattern: /\b500\b|\b502\b|\b503\b|\b504\b|server error|internal error/, code: 'REMOTE_SERVER_ERROR' },
    { pattern: /timeout|timed out|etimedout|econnreset|socket hang up|network error/, code: 'NETWORK_FAILURE' },
    { pattern: /temporar|unavailable|try again|in progress|processing/, code: 'TEMPORARY_PLATFORM_STATE' },
  ];
  for (const { pattern, code } of transientPatterns) {
    if (pattern.test(normalized)) {
      return { code, category: 'transient', retryable: true };
    }
  }

  const permanentPatterns: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /requires media|text-only posts are not supported/, code: 'MEDIA_REQUIRED' },
    { pattern: /integration is not configured|connection not found|not configured or disabled/, code: 'INTEGRATION_MISSING' },
    { pattern: /product not found|no associated product/, code: 'PRODUCT_MISSING' },
    { pattern: /unsupported channel|invalid|forbidden|unauthenticated/, code: 'INVALID_REQUEST' },
  ];
  for (const { pattern, code } of permanentPatterns) {
    if (pattern.test(normalized)) {
      return { code, category: 'permanent', retryable: false };
    }
  }

  return { code: 'UNKNOWN_PUBLISH_ERROR', category: 'transient', retryable: true };
}

function getRetryDelayMs(attemptCount: number): number {
  const idx = Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[idx] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

function computeRetryAt(attemptCount: number): string {
  return new Date(Date.now() + getRetryDelayMs(attemptCount)).toISOString();
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function aggregateChannelResults(
  channelResults: ChannelPublishResult[],
  primaryChannel: SocialChannel,
): MultiChannelPublishResult {
  const primaryResult = channelResults.find((result) => result.channel === primaryChannel) || channelResults[0];
  const anyPending = channelResults.some((result) => result.pending);
  const allSucceeded = channelResults.length > 0 && channelResults.every((result) => result.success);
  const firstFailure = channelResults.find((result) => !result.success && !result.pending);

  return {
    success: allSucceeded,
    pending: anyPending || undefined,
    channels: channelResults,
    externalId: primaryResult?.externalId,
    externalUrl: primaryResult?.externalUrl,
    error: !allSucceeded && !anyPending ? firstFailure?.error || 'One or more channels failed to publish' : undefined,
  };
}

function buildLeaseExpiry(): string {
  return new Date(Date.now() + PUBLISH_LEASE_MS).toISOString();
}

async function claimDueScheduledPosts(
  workspaceId: string,
  workerId: string,
): Promise<ClaimedScheduledPost[]> {
  const nowIso = new Date().toISOString();
  const postsRef = adminDb.collection(`workspaces/${workspaceId}/posts`);
  const snap = await postsRef
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', nowIso)
    .orderBy('scheduledAt', 'asc')
    .limit(MAX_DUE_POSTS_PER_RUN)
    .get();

  const claimed: ClaimedScheduledPost[] = [];

  for (const doc of snap.docs) {
    try {
      const transactionResult = await adminDb.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return null;

        const post = fresh.data() as Record<string, unknown>;
        const scheduledAt = typeof post.scheduledAt === 'string' ? post.scheduledAt : null;
        if (post.status !== 'scheduled' || !scheduledAt || scheduledAt > nowIso) {
          return null;
        }

        const attemptCount = typeof post.publishAttemptCount === 'number' ? post.publishAttemptCount : 0;
        const attemptId = crypto.randomUUID();
        tx.update(doc.ref, {
          status: 'publishing',
          publishAttemptId: attemptId,
          publishAttemptCount: attemptCount + 1,
          publishStartedAt: nowIso,
          lastPublishAttemptAt: nowIso,
          publishLeaseExpiresAt: buildLeaseExpiry(),
          claimedAt: nowIso,
          claimedByWorker: workerId,
          updatedAt: nowIso,
        });

        return {
          postId: doc.id,
          productId: typeof post.productId === 'string' ? post.productId : undefined,
          post,
          attemptId,
          attemptCount: attemptCount + 1,
        } satisfies ClaimedScheduledPost;
      });

      if (transactionResult) {
        claimed.push(transactionResult);
      }
    } catch (error) {
      console.error(`[scheduled] Failed to claim post ${doc.id}:`, error);
    }
  }

  return claimed;
}

async function finalizeSuccessfulPublish(
  workspaceId: string,
  claimed: ClaimedScheduledPost,
  result: MultiChannelPublishResult,
): Promise<'published' | 'pending'> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
  const nowIso = new Date().toISOString();

  if (result.pending) {
    await ref.update({
      status: 'publishing',
      externalId: result.externalId || '',
      externalUrl: result.externalUrl || '',
      publishResults: result.channels,
      publishFinishedAt: null,
      publishLeaseExpiresAt: null,
      updatedAt: nowIso,
    });
    return 'pending';
  }

  await ref.update({
    status: 'published',
    externalId: result.externalId || '',
    externalUrl: result.externalUrl || '',
    publishResults: result.channels,
    publishedChannels: result.channels.filter((channel) => channel.success).map((channel) => channel.channel),
    publishedAt: nowIso,
    publishFinishedAt: nowIso,
    publishLeaseExpiresAt: null,
    errorMessage: '',
    lastErrorCode: '',
    lastErrorCategory: '',
    nextRetryAt: null,
    updatedAt: nowIso,
  });
  return 'published';
}

async function finalizeFailedPublish(
  workspaceId: string,
  claimed: ClaimedScheduledPost,
  result: MultiChannelPublishResult,
): Promise<'retried' | 'failed'> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
  const nowIso = new Date().toISOString();
  const message = result.error || 'Unknown publishing error';
  const classification = classifyPublishError(message);
  const originalScheduledAt = typeof claimed.post.originalScheduledAt === 'string'
    ? claimed.post.originalScheduledAt
    : typeof claimed.post.scheduledAt === 'string'
      ? claimed.post.scheduledAt
      : null;

  if (classification.retryable && claimed.attemptCount < MAX_RETRY_ATTEMPTS) {
    const retryAt = computeRetryAt(claimed.attemptCount);
    await ref.update({
      status: 'scheduled',
      scheduledAt: retryAt,
      originalScheduledAt,
      nextRetryAt: retryAt,
      errorMessage: message,
      lastErrorCode: classification.code,
      lastErrorCategory: classification.category,
      publishResults: result.channels,
      publishFinishedAt: nowIso,
      publishLeaseExpiresAt: null,
      updatedAt: nowIso,
    });
    return 'retried';
  }

  await ref.update({
    status: 'failed',
    errorMessage: message,
    lastErrorCode: classification.code,
    lastErrorCategory: classification.category,
    publishResults: result.channels,
    publishFinishedAt: nowIso,
    publishLeaseExpiresAt: null,
    updatedAt: nowIso,
  });
  return 'failed';
}

async function recoverSingleStalePublish(
  workspaceId: string,
  postId: string,
  post: Record<string, unknown>,
): Promise<'recovered' | 'failed' | 'skipped'> {
  if (post.channel === 'tiktok' && typeof post.externalId === 'string' && post.externalId) {
    return 'skipped';
  }

  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`);
  const nowIso = new Date().toISOString();
  const attemptCount = typeof post.publishAttemptCount === 'number' ? post.publishAttemptCount : 1;
  const classification = classifyPublishError('Publish lease expired before completion');
  const originalScheduledAt = typeof post.originalScheduledAt === 'string'
    ? post.originalScheduledAt
    : typeof post.scheduledAt === 'string'
      ? post.scheduledAt
      : null;

  if (attemptCount < MAX_RETRY_ATTEMPTS) {
    const retryAt = computeRetryAt(attemptCount);
    await ref.update({
      status: 'scheduled',
      scheduledAt: retryAt,
      originalScheduledAt,
      nextRetryAt: retryAt,
      errorMessage: 'Recovered stale publish attempt and rescheduled automatically',
      lastErrorCode: classification.code,
      lastErrorCategory: classification.category,
      publishFinishedAt: nowIso,
      publishLeaseExpiresAt: null,
      updatedAt: nowIso,
    });
    return 'recovered';
  }

  await ref.update({
    status: 'failed',
    errorMessage: 'Publish lease expired before completion',
    lastErrorCode: classification.code,
    lastErrorCategory: classification.category,
    publishFinishedAt: nowIso,
    publishLeaseExpiresAt: null,
    updatedAt: nowIso,
  });
  return 'failed';
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
      ...(result.pending != null && { pending: result.pending }),
      ...(result.externalId != null && { externalId: result.externalId }),
      ...(result.externalUrl != null && { externalUrl: result.externalUrl }),
      ...(result.error != null && { error: result.error }),
    });
  }

  // Preserve existing direct-publish semantics for the selected primary channel.
  const primaryResult = results.find((result) => result.channel === request.channel) || results[0];

  return {
    success: Boolean(primaryResult?.success),
    pending: primaryResult?.pending,
    channels: results,
    externalId: primaryResult?.externalId,
    externalUrl: primaryResult?.externalUrl,
    error: primaryResult?.success ? undefined : primaryResult?.error,
  };
}

export async function recoverStalePublishingPosts(workspaceId: string): Promise<{ recovered: number; failed: number; errors: Array<{ postId: string; error: string }> }> {
  const postsRef = adminDb.collection(`workspaces/${workspaceId}/posts`);
  const staleBefore = new Date(Date.now() - PUBLISH_LEASE_MS).toISOString();
  const snap = await postsRef
    .where('status', '==', 'publishing')
    .orderBy('updatedAt', 'asc')
    .limit(MAX_RECOVERIES_PER_RUN)
    .get();

  let recovered = 0;
  let failed = 0;
  const errors: Array<{ postId: string; error: string }> = [];

  for (const doc of snap.docs) {
    const post = doc.data() as Record<string, unknown>;
    const leaseExpiresAt = typeof post.publishLeaseExpiresAt === 'string' ? post.publishLeaseExpiresAt : null;
    const updatedAt = typeof post.updatedAt === 'string' ? post.updatedAt : null;
    const isStale = leaseExpiresAt ? leaseExpiresAt <= new Date().toISOString() : Boolean(updatedAt && updatedAt <= staleBefore);
    if (!isStale) {
      continue;
    }

    try {
      const outcome = await recoverSingleStalePublish(workspaceId, doc.id, post);
      if (outcome === 'recovered') recovered++;
      if (outcome === 'failed') failed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown stale publish recovery error';
      errors.push({ postId: doc.id, error: message });
    }
  }

  return { recovered, failed, errors };
}

/**
 * Process all scheduled posts that are due for publishing.
 */
export async function processScheduledPosts(workspaceId: string): Promise<ScheduledPostsProcessResult> {
  const workerId = crypto.randomUUID();
  const claimedPosts = await claimDueScheduledPosts(workspaceId, workerId);

  const summary: ScheduledPostsProcessResult = {
    claimed: claimedPosts.length,
    processed: 0,
    published: 0,
    pending: 0,
    retried: 0,
    failed: 0,
    recovered: 0,
    results: [],
    errors: [],
  };

  for (const claimed of claimedPosts) {
    try {
      const targetChannels = asStringArray(claimed.post.targetChannels) as SocialChannel[] | undefined;
      let result: MultiChannelPublishResult;

      if (!claimed.productId && claimed.post.channel !== 'tiktok') {
        result = {
          success: false,
          channels: [],
          error: 'Post has no associated product',
        };
      } else if (targetChannels && targetChannels.length > 0) {
        const channelResults: ChannelPublishResult[] = [];
        for (const channel of targetChannels) {
          const channelResult = await publishPost(workspaceId, claimed.productId, {
            content: String(claimed.post.content || ''),
            channel,
            mediaUrls: asStringArray(claimed.post.mediaUrls),
          });
          channelResults.push({
            channel,
            success: channelResult.success,
            ...(channelResult.pending != null && { pending: channelResult.pending }),
            ...(channelResult.externalId != null && { externalId: channelResult.externalId }),
            ...(channelResult.externalUrl != null && { externalUrl: channelResult.externalUrl }),
            ...(channelResult.error != null && { error: channelResult.error }),
          });
        }

        result = aggregateChannelResults(
          channelResults,
          String(claimed.post.channel || targetChannels[0]) as SocialChannel,
        );
      } else {
        result = await publishPostMultiChannel(workspaceId, claimed.productId, {
          content: String(claimed.post.content || ''),
          channel: String(claimed.post.channel) as SocialChannel,
          mediaUrls: asStringArray(claimed.post.mediaUrls),
        });
      }

      const outcome = result.success || result.pending
        ? await finalizeSuccessfulPublish(workspaceId, claimed, result)
        : await finalizeFailedPublish(workspaceId, claimed, result);

      summary.processed++;
      summary.results.push({ postId: claimed.postId, outcome, error: result.error });
      if (outcome === 'published') summary.published++;
      if (outcome === 'pending') summary.pending++;
      if (outcome === 'retried') summary.retried++;
      if (outcome === 'failed') summary.failed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown publishing error';
      const classification = classifyPublishError(message);
      const nowIso = new Date().toISOString();
      const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
      const originalScheduledAt = typeof claimed.post.originalScheduledAt === 'string'
        ? claimed.post.originalScheduledAt
        : typeof claimed.post.scheduledAt === 'string'
          ? claimed.post.scheduledAt
          : null;

      try {
        if (classification.retryable && claimed.attemptCount < MAX_RETRY_ATTEMPTS) {
          const retryAt = computeRetryAt(claimed.attemptCount);
          await ref.update({
            status: 'scheduled',
            scheduledAt: retryAt,
            originalScheduledAt,
            nextRetryAt: retryAt,
            errorMessage: message,
            lastErrorCode: classification.code,
            lastErrorCategory: classification.category,
            publishFinishedAt: nowIso,
            publishLeaseExpiresAt: null,
            updatedAt: nowIso,
          });
          summary.retried++;
          summary.results.push({ postId: claimed.postId, outcome: 'retried', error: message });
        } else {
          await ref.update({
            status: 'failed',
            errorMessage: message,
            lastErrorCode: classification.code,
            lastErrorCategory: classification.category,
            publishFinishedAt: nowIso,
            publishLeaseExpiresAt: null,
            updatedAt: nowIso,
          });
          summary.failed++;
          summary.results.push({ postId: claimed.postId, outcome: 'failed', error: message });
        }
      } catch (updateError) {
        const updateMessage = updateError instanceof Error ? updateError.message : 'Unknown post recovery error';
        summary.errors.push({ postId: claimed.postId, error: updateMessage });
      }
      summary.processed++;
    }
  }

  return summary;
}
