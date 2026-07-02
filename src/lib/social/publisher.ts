import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { getAdapterForChannel } from '@/lib/platform/registry';
import {
  getConnectionForChannel,
  getLinkedInConnectionForDestination,
  markConnectionAuthError,
} from '@/lib/platform/connections';
import type { PublishRequest, PublishResult } from '@/lib/platform/types';
import { isTikTokTokenExpiringSoon, isTikTokTokenInvalid, refreshTikTokConnection } from '@/lib/platform/tiktok-auth';
import { socialChannels, type SocialChannel } from '@/lib/schemas';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import {
  isTikTokDraftOnlyChannel,
  LEGACY_EXPORTED_FOR_REVIEW_STATUS,
  PLATFORM_ACTION_REQUIRED_STATUS,
  validateTikTokMediaUrls,
} from '@/lib/tiktok-draft-flow';
import { firstSocialPostValidationError } from '@/lib/social/post-validation';
import { getTikTokPublishMappingRef } from '@/lib/social/tiktok-publish-mapping';
import { logger } from '@/lib/logger';

export type { PublishRequest, PublishResult };

const MAX_DUE_POSTS_PER_RUN = 50;
const MAX_RECOVERIES_PER_RUN = 50;
const PUBLISH_LEASE_MS = 10 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

// Instagram/Meta rate-limit and quota errors need longer backoff to avoid triggering account restrictions.
const META_MAX_RETRY_ATTEMPTS = 2;
const META_RETRY_DELAYS_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000]; // 30min, 2hr
const socialChannelSet = new Set<string>(socialChannels);

export type ChannelPublishResult = {
  channel: SocialChannel;
  success: boolean;
  pending?: boolean;
  externalId?: string;
  externalUrl?: string;
  nextAction?: string;
  error?: string;
};

export type MultiChannelPublishResult = {
  /** True only when all required channels have completed successfully */
  success: boolean;
  /** True when at least one channel succeeded and at least one channel failed */
  partialFailure?: boolean;
  /** True when one or more channels are still processing asynchronously */
  pending?: boolean;
  /** Results for each channel that was attempted */
  channels: ChannelPublishResult[];
  /** Primary channel external ID (for backwards compat) */
  externalId?: string;
  /** Primary channel external URL (for backwards compat) */
  externalUrl?: string;
  nextAction?: string;
  /** Error message if the publish did not complete successfully */
  error?: string;
};

type PublishErrorClassification = {
  code: string;
  category: 'transient' | 'permanent';
  retryable: boolean;
  /** True when the error is a Meta/Instagram rate-limit or quota issue that requires longer backoff. */
  metaRateLimited?: boolean;
};

type ClaimedScheduledPost = {
  postId: string;
  productId?: string;
  post: Record<string, unknown>;
  attemptId: string;
  attemptCount: number;
};

export type ClaimedPublishPost = ClaimedScheduledPost;

type FinalizePublishOptions = {
  retryOnFailure?: boolean;
};

type PublishStoredPostOptions = {
  onChannelResult?: (result: ChannelPublishResult) => Promise<void>;
};

export type ScheduledPostsProcessResult = {
  claimed: number;
  processed: number;
  published: number;
  pending: number;
  retried: number;
  failed: number;
  partialFailed: number;
  recovered: number;
  results: Array<{ postId: string; outcome: 'published' | 'pending' | 'retried' | 'failed' | 'partial_failed' | 'recovered'; error?: string }>;
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
  if (isTikTokDraftOnlyChannel(request.channel)) {
    const validationError = validateTikTokMediaUrls(request.mediaUrls);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // TikTok "review" is a platform inbox handoff. Keep going through the
    // adapter so the server waits for TikTok to confirm SEND_TO_USER_INBOX.
  }

  const adapter = getAdapterForChannel(request.channel);
  if (!adapter) {
    return { success: false, error: `Unsupported channel: ${request.channel}` };
  }

  const connection = request.channel === 'linkedin'
    ? await getLinkedInConnectionForDestination(
      workspaceId,
      productId,
      request.destinationId,
      request.destinationProvider,
    )
    : await getConnectionForChannel(
      workspaceId,
      request.channel,
      productId,
      request.destinationProvider,
    );
  if (!connection) {
    return { success: false, error: `${request.channel} integration is not configured or disabled` };
  }

  const validationError = adapter.validateConnection(connection, request.channel);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // TikTok tokens expire fast; refresh up front if the token is at/near expiry,
  // then fall back to a reactive refresh-and-retry if TikTok still rejects it.
  let activeConnection = connection;
  if (request.channel === 'tiktok' && isTikTokTokenExpiringSoon(activeConnection)) {
    activeConnection = (await refreshTikTokConnection(workspaceId, productId, activeConnection)) ?? activeConnection;
  }

  const result = await adapter.publish(activeConnection, request);

  if (
    request.channel === 'linkedin' &&
    result.error &&
    /LINKEDIN_AUTH_REVOKED|LINKEDIN_PERMISSION_DENIED/i.test(result.error)
  ) {
    await markConnectionAuthError(
      workspaceId,
      activeConnection.provider,
      result.error,
      activeConnection.productId || productId,
    ).catch(() => undefined);
  }

  if (request.channel === 'tiktok' && isTikTokTokenInvalid(result.error)) {
    const refreshed = await refreshTikTokConnection(workspaceId, productId, activeConnection);
    if (refreshed) {
      return adapter.publish(refreshed, request);
    }
  }

  return result;
}

function classifyPublishError(error: string): PublishErrorClassification {
  const normalized = error.toLowerCase();

  // Meta/Instagram-specific rate-limit and quota errors get longer backoff
  const metaRateLimitPatterns: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /publishing limit reached|quota_usage/, code: 'IG_PUBLISH_QUOTA_EXCEEDED' },
    { pattern: /meta api rate limit approaching|backing off to avoid/, code: 'META_APP_USAGE_THROTTLED' },
    { pattern: /page publishing authorization|ppa/, code: 'PPA_REQUIRED' },
  ];
  for (const { pattern, code } of metaRateLimitPatterns) {
    if (pattern.test(normalized)) {
      return { code, category: 'transient', retryable: true, metaRateLimited: true };
    }
  }

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
    { pattern: /linkedin_auth_revoked|linkedin_permission_denied|permission_denied|insufficient permissions/, code: 'AUTHORIZATION_REQUIRED' },
    { pattern: /unsupported channel|invalid|forbidden|unauthenticated/, code: 'INVALID_REQUEST' },
  ];
  for (const { pattern, code } of permanentPatterns) {
    if (pattern.test(normalized)) {
      return { code, category: 'permanent', retryable: false };
    }
  }

  return { code: 'UNKNOWN_PUBLISH_ERROR', category: 'transient', retryable: true };
}

function getRetryDelayMs(attemptCount: number, metaRateLimited?: boolean): number {
  const delays = metaRateLimited ? META_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
  const idx = Math.min(Math.max(attemptCount - 1, 0), delays.length - 1);
  return delays[idx] || delays[delays.length - 1];
}

function computeRetryAt(attemptCount: number, metaRateLimited?: boolean): string {
  return new Date(Date.now() + getRetryDelayMs(attemptCount, metaRateLimited)).toISOString();
}

function getMaxRetryAttempts(metaRateLimited?: boolean): number {
  return metaRateLimited ? META_MAX_RETRY_ATTEMPTS : MAX_RETRY_ATTEMPTS;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function asSocialChannel(value: unknown): value is SocialChannel {
  return typeof value === 'string' && socialChannelSet.has(value);
}

function getDestinationProvider(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function getDestinationId(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function getEffectiveDeliveryMode(channel: SocialChannel): PublishRequest['deliveryMode'] {
  return channel === 'tiktok' ? 'platform_inbox' : 'direct_publish';
}

function getPhotoCoverIndex(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function getPostTargetChannels(post: Record<string, unknown>): SocialChannel[] {
  const rawTargetChannels = asStringArray(post.targetChannels);
  const targetChannels = rawTargetChannels
    ?.filter(asSocialChannel)
    .filter((channel, index, all) => all.indexOf(channel) === index);

  if (rawTargetChannels) {
    return targetChannels ?? [];
  }

  return asSocialChannel(post.channel) ? [post.channel] : [];
}

function shouldReuseSuccessfulChannelResults(post: Record<string, unknown>): boolean {
  return post.retryFailedChannelsOnly === true || post.status === 'failed' || post.status === 'partial_failed';
}

function getReusableSuccessfulChannelResults(
  post: Record<string, unknown>,
  targetChannels: SocialChannel[],
): ChannelPublishResult[] {
  if (!shouldReuseSuccessfulChannelResults(post) || !Array.isArray(post.publishResults)) {
    return [];
  }

  const targetSet = new Set(targetChannels);
  const seen = new Set<SocialChannel>();
  const reusable: ChannelPublishResult[] = [];

  for (const result of post.publishResults) {
    if (!result || typeof result !== 'object') continue;
    const current = result as Record<string, unknown>;
    const channel = current.channel;
    if (!asSocialChannel(channel) || !targetSet.has(channel) || seen.has(channel)) continue;
    if (current.success !== true) continue;

    seen.add(channel);
    reusable.push({
      channel,
      success: true,
      ...(typeof current.externalId === 'string' && { externalId: current.externalId }),
      ...(typeof current.externalUrl === 'string' && { externalUrl: current.externalUrl }),
      ...(typeof current.nextAction === 'string' && { nextAction: current.nextAction }),
    });
  }

  return reusable;
}

function asChannelPublishResult(value: unknown): ChannelPublishResult | null {
  if (!value || typeof value !== 'object') return null;
  const current = value as Record<string, unknown>;
  if (!asSocialChannel(current.channel)) return null;

  return {
    channel: current.channel,
    success: current.success === true,
    ...(current.pending != null && { pending: current.pending === true }),
    ...(typeof current.externalId === 'string' && { externalId: current.externalId }),
    ...(typeof current.externalUrl === 'string' && { externalUrl: current.externalUrl }),
    ...(typeof current.nextAction === 'string' && { nextAction: current.nextAction }),
    ...(typeof current.error === 'string' && { error: current.error }),
  };
}

function mergeInFlightChannelResult(
  targetChannels: SocialChannel[],
  existingResults: unknown,
  incoming: ChannelPublishResult,
): ChannelPublishResult[] {
  const byChannel = new Map<SocialChannel, ChannelPublishResult>();

  for (const channel of targetChannels) {
    byChannel.set(channel, { channel, success: false, pending: true });
  }

  if (Array.isArray(existingResults)) {
    for (const item of existingResults) {
      const parsed = asChannelPublishResult(item);
      if (!parsed || !byChannel.has(parsed.channel)) continue;
      byChannel.set(parsed.channel, parsed);
    }
  }

  if (byChannel.has(incoming.channel)) {
    byChannel.set(incoming.channel, incoming);
  }

  return targetChannels
    .map((channel) => byChannel.get(channel))
    .filter((item): item is ChannelPublishResult => Boolean(item));
}

function mergeCompletedChannelResults(
  nextResults: ChannelPublishResult[],
  existingResults: unknown,
): ChannelPublishResult[] {
  if (!Array.isArray(existingResults)) return nextResults;

  const completedByChannel = new Map<SocialChannel, ChannelPublishResult>();
  for (const item of existingResults) {
    const parsed = asChannelPublishResult(item);
    if (!parsed || parsed.success !== true) continue;
    completedByChannel.set(parsed.channel, parsed);
  }

  return nextResults.map((next) => {
    const completed = completedByChannel.get(next.channel);
    if (!completed) return next;

    const sameExternalId =
      !next.externalId ||
      !completed.externalId ||
      next.externalId === completed.externalId;

    if (!sameExternalId || next.success === true) return next;

    return {
      ...next,
      ...completed,
      success: true,
      pending: false,
    };
  });
}

export async function persistTikTokPendingPublish(
  workspaceId: string,
  claimed: ClaimedPublishPost,
  targetChannels: SocialChannel[],
  result: ChannelPublishResult,
): Promise<void> {
  if (result.channel !== 'tiktok' || !result.externalId) return;

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const postRef = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
  const mappingRef = getTikTokPublishMappingRef(result.externalId);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) return;

    const current = snap.data() as Record<string, unknown>;
    if (current.publishAttemptId !== claimed.attemptId || current.status !== 'publishing') {
      return;
    }

    const mergedResults = mergeInFlightChannelResult(targetChannels, current.publishResults, result);
    const currentExternalId = typeof current.externalId === 'string' ? current.externalId : '';
    const shouldUseTikTokAsPrimary = targetChannels[0] === 'tiktok' || !currentExternalId;

    tx.update(postRef, {
      ...(shouldUseTikTokAsPrimary ? { externalId: result.externalId } : {}),
      tiktokPublishId: result.externalId,
      publishResults: mergedResults,
      updatedAt: nowIso,
    });
    tx.set(mappingRef, {
      publishId: result.externalId,
      workspaceId,
      postId: claimed.postId,
      attemptId: claimed.attemptId,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt,
    }, { merge: true });
  });

  logger.info('tiktok pending publish id persisted', {
    event: 'posts.publish.tiktok_publish_id_persisted',
    workspaceId,
    postId: claimed.postId,
    publishId: result.externalId,
  });
}

function getRemainingTargetChannels(
  targetChannels: SocialChannel[],
  reusableResults: ChannelPublishResult[],
): SocialChannel[] {
  const alreadySucceeded = new Set(reusableResults.map((result) => result.channel));
  return targetChannels.filter((channel) => !alreadySucceeded.has(channel));
}

function aggregateChannelResults(
  channelResults: ChannelPublishResult[],
  primaryChannel: SocialChannel,
): MultiChannelPublishResult {
  const primaryResult = channelResults.find((result) => result.channel === primaryChannel) || channelResults[0];
  const anyPending = channelResults.some((result) => result.pending);
  const allSucceeded = channelResults.length > 0 && channelResults.every((result) => result.success);
  const anySucceeded = channelResults.some((result) => result.success);
  const firstFailure = channelResults.find((result) => !result.success && !result.pending);
  const anyFailure = Boolean(firstFailure);

  return {
    success: allSucceeded,
    partialFailure: anySucceeded && anyFailure ? true : undefined,
    pending: anyPending || undefined,
    channels: channelResults,
    externalId: primaryResult?.externalId,
    externalUrl: primaryResult?.externalUrl,
    nextAction: primaryResult?.nextAction,
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

export type ImmediatePublishClaimResult =
  | { ok: true; claimed: ClaimedPublishPost }
  | { ok: false; status: number; error: string };

export async function claimPostForImmediatePublish(
  workspaceId: string,
  postId: string,
  workerId = `direct:${crypto.randomUUID()}`,
): Promise<ImmediatePublishClaimResult> {
  const nowIso = new Date().toISOString();
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`);
  const publishableStatuses = new Set([
    'draft',
    'scheduled',
    'failed',
    'partial_failed',
    PLATFORM_ACTION_REQUIRED_STATUS,
    LEGACY_EXPORTED_FOR_REVIEW_STATUS,
  ]);

  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, status: 404, error: 'Post not found' } satisfies ImmediatePublishClaimResult;
    }

    const post = snap.data() as Record<string, unknown>;
    const status = typeof post.status === 'string' ? post.status : '';
    const leaseExpiresAt = typeof post.publishLeaseExpiresAt === 'string' ? post.publishLeaseExpiresAt : '';

    if (status === 'publishing' && leaseExpiresAt && leaseExpiresAt > nowIso) {
      return { ok: false, status: 409, error: 'This post is already publishing.' } satisfies ImmediatePublishClaimResult;
    }

    if (status === 'publishing' && !leaseExpiresAt) {
      return { ok: false, status: 409, error: 'This post is already publishing.' } satisfies ImmediatePublishClaimResult;
    }

    const targetChannels = getPostTargetChannels(post);
    if (
      (status === PLATFORM_ACTION_REQUIRED_STATUS || status === LEGACY_EXPORTED_FOR_REVIEW_STATUS) &&
      targetChannels.includes('tiktok')
    ) {
      return {
        ok: false,
        status: 409,
        error: 'This TikTok post is already ready in the TikTok inbox.',
      } satisfies ImmediatePublishClaimResult;
    }

    if (status !== 'publishing' && !publishableStatuses.has(status)) {
      return {
        ok: false,
        status: 400,
        error: `Cannot publish a post with status "${post.status}"`,
      } satisfies ImmediatePublishClaimResult;
    }

    const attemptCount = typeof post.publishAttemptCount === 'number' ? post.publishAttemptCount : 0;
    const attemptId = crypto.randomUUID();
    tx.update(ref, {
      status: 'publishing',
      publishAttemptId: attemptId,
      publishAttemptCount: attemptCount + 1,
      publishStartedAt: nowIso,
      lastPublishAttemptAt: nowIso,
      publishLeaseExpiresAt: buildLeaseExpiry(),
      claimedAt: nowIso,
      claimedByWorker: workerId,
      externalId: '',
      externalUrl: '',
      errorMessage: '',
      lastErrorCode: '',
      lastErrorCategory: '',
      nextRetryAt: null,
      scheduledAt: null,
      updatedAt: nowIso,
    });

    return {
      ok: true,
      claimed: {
        postId,
        productId: typeof post.productId === 'string' ? post.productId : undefined,
        post,
        attemptId,
        attemptCount: attemptCount + 1,
      },
    } satisfies ImmediatePublishClaimResult;
  });

  return claimed;
}

export async function finalizeSuccessfulPublish(
  workspaceId: string,
  claimed: ClaimedPublishPost,
  result: MultiChannelPublishResult,
): Promise<'published' | 'pending'> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
  const nowIso = new Date().toISOString();

  if (result.pending) {
    const currentSnap = await ref.get();
    const currentPost = currentSnap.exists ? currentSnap.data() as Record<string, unknown> : {};
    const mergedChannels = mergeCompletedChannelResults(result.channels, currentPost.publishResults);
    const tiktokResult = mergedChannels.find((channel) => channel.channel === 'tiktok');

    await ref.update({
      status: 'publishing',
      externalId: result.externalId || '',
      externalUrl: result.externalUrl || '',
      ...(tiktokResult?.externalId ? { tiktokPublishId: tiktokResult.externalId } : {}),
      publishResults: mergedChannels,
      publishFinishedAt: null,
      publishLeaseExpiresAt: null,
      retryFailedChannelsOnly: result.partialFailure ? true : null,
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
    retryFailedChannelsOnly: null,
    updatedAt: nowIso,
  });
  if (claimed.post.createdByType === 'api_client') {
    await enqueueWebhookEvent(workspaceId, 'post.published', {
      postId: claimed.postId,
      channel: claimed.post.channel,
      status: 'published',
      externalId: result.externalId || '',
      externalUrl: result.externalUrl || '',
    });
  }
  return 'published';
}

export async function finalizeFailedPublish(
  workspaceId: string,
  claimed: ClaimedPublishPost,
  result: MultiChannelPublishResult,
  options: FinalizePublishOptions = {},
): Promise<'retried' | 'failed' | 'partial_failed'> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${claimed.postId}`);
  const nowIso = new Date().toISOString();
  const message = result.error || 'Unknown publishing error';
  const classification = classifyPublishError(message);
  const hasSuccessfulChannel = result.channels.some((channel) => channel.success);
  const hasFailedChannel = result.channels.some((channel) => !channel.success && !channel.pending);
  const partialFailure = result.partialFailure || (hasSuccessfulChannel && hasFailedChannel);
  const originalScheduledAt = typeof claimed.post.originalScheduledAt === 'string'
    ? claimed.post.originalScheduledAt
    : typeof claimed.post.scheduledAt === 'string'
      ? claimed.post.scheduledAt
      : null;

  const maxRetries = getMaxRetryAttempts(classification.metaRateLimited);
  const retryOnFailure = options.retryOnFailure ?? true;

  if (retryOnFailure && classification.retryable && claimed.attemptCount < maxRetries) {
    const retryAt = computeRetryAt(claimed.attemptCount, classification.metaRateLimited);
    await ref.update({
      status: 'scheduled',
      scheduledAt: retryAt,
      originalScheduledAt,
      nextRetryAt: retryAt,
      errorMessage: message,
      lastErrorCode: classification.code,
      lastErrorCategory: classification.category,
      publishResults: result.channels,
      publishedChannels: result.channels.filter((channel) => channel.success).map((channel) => channel.channel),
      retryFailedChannelsOnly: partialFailure ? true : null,
      publishFinishedAt: nowIso,
      publishLeaseExpiresAt: null,
      updatedAt: nowIso,
    });
    return 'retried';
  }

  await ref.update({
    status: partialFailure ? 'partial_failed' : 'failed',
    errorMessage: message,
    lastErrorCode: classification.code,
    lastErrorCategory: classification.category,
    publishResults: result.channels,
    publishedChannels: result.channels.filter((channel) => channel.success).map((channel) => channel.channel),
    retryFailedChannelsOnly: partialFailure ? true : null,
    publishFinishedAt: nowIso,
    publishLeaseExpiresAt: null,
    updatedAt: nowIso,
  });
  if (claimed.post.createdByType === 'api_client') {
    await enqueueWebhookEvent(workspaceId, 'post.failed', {
      postId: claimed.postId,
      channel: claimed.post.channel,
      status: 'failed',
      error: message,
    });
  }
  return partialFailure ? 'partial_failed' : 'failed';
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
 * Publish a post to its single requested channel.
 * Linking a Meta connection no longer fans a post out to both Facebook and
 * Instagram — each channel is its own dedicated path. Users can still target
 * multiple channels explicitly from the composer (see publishExplicitChannels).
 */
export async function publishPostMultiChannel(
  workspaceId: string,
  productId: string | undefined,
  request: PublishRequest,
  options: PublishStoredPostOptions = {},
): Promise<MultiChannelPublishResult> {
  const channels: SocialChannel[] = [request.channel];

  const results: ChannelPublishResult[] = [];

  for (const channel of channels) {
    // For Instagram, skip if no image (text-only not supported) — don't block the whole publish
    if (channel === 'instagram' && (!request.mediaUrls || request.mediaUrls.length === 0)) {
      results.push({
        channel,
        success: false,
        error: 'Skipped — Instagram requires media (image or video)',
      });
      continue;
    }

    const result = await publishPost(workspaceId, productId, {
      ...request,
      channel,
    });

    const channelResult: ChannelPublishResult = {
      channel,
      success: result.success,
      ...(result.pending != null && { pending: result.pending }),
      ...(result.externalId != null && { externalId: result.externalId }),
      ...(result.externalUrl != null && { externalUrl: result.externalUrl }),
      ...(result.nextAction != null && { nextAction: result.nextAction }),
      ...(result.error != null && { error: result.error }),
    };
    results.push(channelResult);
    await options.onChannelResult?.(channelResult);
  }

  return aggregateChannelResults(results, request.channel);
}

async function publishExplicitChannels(
  workspaceId: string,
  productId: string | undefined,
  primaryChannel: SocialChannel,
  targetChannels: SocialChannel[],
  request: Omit<PublishRequest, 'channel'>,
  options: PublishStoredPostOptions = {},
): Promise<MultiChannelPublishResult> {
  const results: ChannelPublishResult[] = [];

  for (const channel of targetChannels) {
    if (channel === 'instagram' && (!request.mediaUrls || request.mediaUrls.length === 0)) {
      results.push({
        channel,
        success: false,
        error: 'Skipped - Instagram requires media (image or video)',
      });
      continue;
    }

    const result = await publishPost(workspaceId, productId, {
      ...request,
      channel,
    });

    const channelResult: ChannelPublishResult = {
      channel,
      success: result.success,
      ...(result.pending != null && { pending: result.pending }),
      ...(result.externalId != null && { externalId: result.externalId }),
      ...(result.externalUrl != null && { externalUrl: result.externalUrl }),
      ...(result.nextAction != null && { nextAction: result.nextAction }),
      ...(result.error != null && { error: result.error }),
    };
    results.push(channelResult);
    await options.onChannelResult?.(channelResult);
  }

  return aggregateChannelResults(results, primaryChannel);
}

export async function publishStoredPost(
  workspaceId: string,
  productId: string | undefined,
  post: Record<string, unknown>,
  options: PublishStoredPostOptions = {},
): Promise<MultiChannelPublishResult> {
  const targetChannels = getPostTargetChannels(post);
  const [primaryChannel] = targetChannels;
  const mediaUrls = asStringArray(post.mediaUrls) ?? [];

  if (!primaryChannel) {
    return {
      success: false,
      channels: [],
      error: 'Post has no target channel',
    };
  }

  if (!productId && targetChannels.some((channel) => channel !== 'tiktok')) {
    return {
      success: false,
      channels: [],
      error: 'Post has no associated product',
    };
  }

  const validationError = firstSocialPostValidationError({
    content: String(post.content || ''),
    channel: primaryChannel,
    targetChannels,
    mediaUrls,
  });
  if (validationError) {
    return {
      success: false,
      channels: [],
      error: validationError,
    };
  }

  const settings = post.settings && typeof post.settings === 'object'
    ? (post.settings as Record<string, unknown>)
    : undefined;
  const settingsPhotoCoverIndex = settings && typeof settings.photoCoverIndex === 'number'
    ? settings.photoCoverIndex
    : undefined;

  const request = {
    content: String(post.content || ''),
    mediaUrls,
    deliveryMode: getEffectiveDeliveryMode(primaryChannel),
    destinationProvider: getDestinationProvider(post.destinationProvider),
    destinationId: getDestinationId(post.destinationId),
    photoCoverIndex: settingsPhotoCoverIndex ?? getPhotoCoverIndex(post.slideshowCoverIndex),
    settings,
  } satisfies Omit<PublishRequest, 'channel'>;

  const reusableResults = getReusableSuccessfulChannelResults(post, targetChannels);
  const remainingChannels = getRemainingTargetChannels(targetChannels, reusableResults);

  if (remainingChannels.length === 0 && reusableResults.length > 0) {
    return aggregateChannelResults(reusableResults, primaryChannel);
  }

  if (targetChannels.length > 1 || asStringArray(post.targetChannels)?.length) {
    const result = await publishExplicitChannels(workspaceId, productId, primaryChannel, remainingChannels, request, options);
    return aggregateChannelResults([...reusableResults, ...result.channels], primaryChannel);
  }

  const result = await publishPostMultiChannel(workspaceId, productId, {
    ...request,
    channel: remainingChannels[0] ?? primaryChannel,
  }, options);
  return aggregateChannelResults([...reusableResults, ...result.channels], primaryChannel);
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
    partialFailed: 0,
    recovered: 0,
    results: [],
    errors: [],
  };

  for (const claimed of claimedPosts) {
    try {
      const targetChannels = getPostTargetChannels(claimed.post);
      const result = await publishStoredPost(workspaceId, claimed.productId, claimed.post, {
        onChannelResult: (channelResult) => persistTikTokPendingPublish(
          workspaceId,
          claimed,
          targetChannels,
          channelResult,
        ),
      });

      const outcome = result.success || result.pending
        ? await finalizeSuccessfulPublish(workspaceId, claimed, result)
        : await finalizeFailedPublish(workspaceId, claimed, result);

      summary.processed++;
      summary.results.push({ postId: claimed.postId, outcome, error: result.error });
      if (outcome === 'published') summary.published++;
      if (outcome === 'pending') summary.pending++;
      if (outcome === 'retried') summary.retried++;
      if (outcome === 'failed') summary.failed++;
      if (outcome === 'partial_failed') summary.partialFailed++;
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
        const maxRetries = getMaxRetryAttempts(classification.metaRateLimited);
        if (classification.retryable && claimed.attemptCount < maxRetries) {
          const retryAt = computeRetryAt(claimed.attemptCount, classification.metaRateLimited);
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
