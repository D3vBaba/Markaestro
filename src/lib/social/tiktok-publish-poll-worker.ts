import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { fetchTikTokPublishStatus } from '@/lib/platform/adapters/tiktok-publishing';
import { isTikTokTokenExpiringSoon, isTikTokTokenInvalid, refreshTikTokConnection } from '@/lib/platform/tiktok-auth';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { sendTikTokInboxEmail } from '@/lib/tiktok-inbox-emails';
import type { SocialChannel } from '@/lib/schemas';
import { getAllDocs } from '@/lib/firestore-pagination';
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import {
  PLATFORM_ACTION_REQUIRED_STATUS,
  TIKTOK_MANUAL_PUBLISH_ACTION,
} from '@/lib/tiktok-draft-flow';
import { getTikTokPublishMappingRef } from '@/lib/social/tiktok-publish-mapping';
import { isTikTokDirectPost } from '@/lib/public-api/post-settings';

type TikTokPublishPollResult = {
  polled: number;
  completed: number;
  failed: number;
  pending: number;
  errors: Array<{ workspaceId: string; postId: string; error: string }>;
};

const TIKTOK_PULL_TIMEOUT_MS = 70 * 60 * 1000;
const MAX_TIKTOK_POLLS_PER_TICK = 50;
const TIKTOK_POLL_CONCURRENCY = 5;
const TIKTOK_MAPPING_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TIKTOK_MAPPING_ACTIVE_RETENTION_MS = 17 * 24 * 60 * 60 * 1000;
const LEGACY_TIKTOK_DISCOVERY_UNTIL_MS = Date.parse('2026-08-25T00:00:00.000Z');

// Active API-driven publishes need quick feedback at first, but a post that is
// still processing must not be polled every minute forever. Inbox hand-offs are
// much slower because the creator has to finish the post in TikTok themselves.
const ACTIVE_POLL_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
const INBOX_POLL_DELAYS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

export type TikTokPostPollOutcome =
  | { status: 'no_external_id' }
  | { status: 'no_connection' }
  | { status: 'still_processing' }
  | { status: 'platform_action_required' }
  | { status: 'published' }
  | { status: 'partial_failed'; error: string }
  | { status: 'failed'; error: string }
  | { status: 'error'; error: string };

function getApiClientId(post: Record<string, unknown>) {
  return post.createdByType === 'api_client' && typeof post.createdById === 'string'
    ? post.createdById
    : null;
}

function getPublishStartedAt(post: Record<string, unknown>): string | null {
  for (const key of ['publishStartedAt', 'lastPublishAttemptAt', 'updatedAt']) {
    const value = post[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function getTikTokPublishId(post: Record<string, unknown>): string | null {
  if (typeof post.tiktokPublishId === 'string' && post.tiktokPublishId) {
    return post.tiktokPublishId;
  }

  if (post.channel === 'tiktok' && typeof post.externalId === 'string' && post.externalId) {
    return post.externalId;
  }

  if (Array.isArray(post.publishResults)) {
    for (const result of post.publishResults) {
      if (!result || typeof result !== 'object') continue;
      const current = result as Record<string, unknown>;
      if (current.channel === 'tiktok' && typeof current.externalId === 'string' && current.externalId) {
        return current.externalId;
      }
    }
  }

  return null;
}

function postTargetsTikTok(post: Record<string, unknown>): boolean {
  if (post.channel === 'tiktok') return true;
  if (Array.isArray(post.targetChannels) && post.targetChannels.includes('tiktok')) return true;
  if (Array.isArray(post.publishResults)) {
    return post.publishResults.some((result) => (
      result &&
      typeof result === 'object' &&
      (result as Record<string, unknown>).channel === 'tiktok'
    ));
  }
  return false;
}

export function isTikTokPollDue(post: Record<string, unknown>, nowMs = Date.now()): boolean {
  if (typeof post.tiktokNextPollAt !== 'string' || !post.tiktokNextPollAt) return true;
  const nextPollMs = Date.parse(post.tiktokNextPollAt);
  return !Number.isFinite(nextPollMs) || nextPollMs <= nowMs;
}

export function getTikTokPollDelayMs(
  post: Record<string, unknown>,
  outcome: TikTokPostPollOutcome,
): number | null {
  if (
    outcome.status === 'published' ||
    outcome.status === 'partial_failed' ||
    outcome.status === 'failed'
  ) {
    return null;
  }

  const attempts = Math.max(0, Number(post.tiktokPollAttemptCount) || 0);
  const isInbox = post.tiktokPollMode === 'inbox' ||
    outcome.status === PLATFORM_ACTION_REQUIRED_STATUS ||
    post.status === PLATFORM_ACTION_REQUIRED_STATUS;
  const pollStartedAt = typeof post.tiktokPollStartedAt === 'string'
    ? Date.parse(post.tiktokPollStartedAt)
    : typeof post.actionRequiredAt === 'string'
      ? Date.parse(post.actionRequiredAt)
      : Number.NaN;
  if (isInbox && Number.isFinite(pollStartedAt) && Date.now() - pollStartedAt > TIKTOK_INBOX_REPOLL_WINDOW_MS) {
    return null;
  }
  const delays = isInbox ? INBOX_POLL_DELAYS_MS : ACTIVE_POLL_DELAYS_MS;
  return delays[Math.min(attempts, delays.length - 1)];
}

async function recordNextTikTokPoll(
  postRef: DocumentReference,
  post: Record<string, unknown>,
  outcome: TikTokPostPollOutcome,
  mappingRef?: DocumentReference,
): Promise<void> {
  const delayMs = getTikTokPollDelayMs(post, outcome);
  const now = Date.now();
  const attemptCount = Math.max(0, Number(post.tiktokPollAttemptCount) || 0) + 1;
  const mappingIdentity = {
    ...(typeof post.tiktokPollWorkspaceId === 'string' ? { workspaceId: post.tiktokPollWorkspaceId } : {}),
    ...(typeof post.tiktokPollPostId === 'string' ? { postId: post.tiktokPollPostId } : {}),
    ...(typeof post.tiktokPublishId === 'string' ? { publishId: post.tiktokPublishId } : {}),
    ...(typeof post.tiktokPollStartedAt === 'string' ? { createdAt: post.tiktokPollStartedAt } : {}),
    ...(post.tiktokPollMode === 'active' || post.tiktokPollMode === 'inbox'
      ? { pollMode: post.tiktokPollMode }
      : {}),
  };
  const batch = adminDb.batch();
  if (delayMs === null) {
    batch.set(postRef, {
      tiktokLastPolledAt: new Date(now).toISOString(),
      tiktokNextPollAt: FieldValue.delete(),
      tiktokPollAttemptCount: attemptCount,
    }, { merge: true });
    if (mappingRef) {
      batch.set(mappingRef, {
        ...mappingIdentity,
        pollStatus: 'terminal',
        pollAttemptCount: attemptCount,
        nextPollAt: FieldValue.delete(),
        terminalAt: new Date(now).toISOString(),
        expiresAt: Timestamp.fromMillis(now + TIKTOK_MAPPING_TERMINAL_RETENTION_MS),
      }, { merge: true });
    }
  } else {
    const nextPollAt = new Date(now + delayMs).toISOString();
    batch.set(postRef, {
      tiktokLastPolledAt: new Date(now).toISOString(),
      tiktokNextPollAt: nextPollAt,
      tiktokPollAttemptCount: attemptCount,
    }, { merge: true });
    if (mappingRef) {
      batch.set(mappingRef, {
        ...mappingIdentity,
        pollStatus: 'active',
        pollAttemptCount: attemptCount,
        nextPollAt,
        updatedAt: new Date(now).toISOString(),
        expiresAt: Timestamp.fromMillis(now + TIKTOK_MAPPING_ACTIVE_RETENTION_MS),
      }, { merge: true });
    }
  }
  await batch.commit();
}

function isPastTikTokPullTimeout(post: Record<string, unknown>): boolean {
  const startedAt = getPublishStartedAt(post);
  if (!startedAt) return false;

  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return false;
  return Date.now() - startedMs > TIKTOK_PULL_TIMEOUT_MS;
}

function withUpdatedTikTokResult(
  publishResults: unknown,
  status: 'success' | 'failed' | 'pending',
  error?: string,
  externalId?: string,
) {
  const next = Array.isArray(publishResults)
    ? publishResults.map((result) => {
        if (!result || typeof result !== 'object' || (result as { channel?: string }).channel !== 'tiktok') {
          return result;
        }

        return {
          ...(result as Record<string, unknown>),
          success: status === 'success',
          pending: status === 'pending',
          ...(externalId ? { externalId } : {}),
          ...(error ? { error } : {}),
        };
      })
    : [];

  if (next.length > 0) return next;

  return [
    {
      channel: 'tiktok',
      success: status === 'success',
      pending: status === 'pending',
      ...(externalId ? { externalId } : {}),
      ...(error ? { error } : {}),
    },
  ];
}

function firstTikTokPublicPostId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === 'string' && item.length > 0);
    return first ?? null;
  }
  return null;
}

function getSuccessfulChannels(publishResults: unknown): SocialChannel[] {
  if (!Array.isArray(publishResults)) return [];
  return publishResults
    .filter((result): result is { channel: SocialChannel; success?: boolean } => !!result && typeof result === 'object' && typeof (result as { channel?: string }).channel === 'string')
    .filter((result) => Boolean(result.success))
    .map((result) => result.channel);
}

function summarizePublishResults(publishResults: unknown): {
  allSucceeded: boolean;
  anyPending: boolean;
  partialFailed: boolean;
  firstError?: string;
  publishedChannels: SocialChannel[];
} {
  if (!Array.isArray(publishResults) || publishResults.length === 0) {
    return { allSucceeded: false, anyPending: false, partialFailed: false, firstError: 'Missing publish results', publishedChannels: [] };
  }

  let anyPending = false;
  let allSucceeded = true;
  let anySucceeded = false;
  let firstError: string | undefined;

  for (const result of publishResults) {
    if (!result || typeof result !== 'object') {
      allSucceeded = false;
      firstError ||= 'Malformed publish result';
      continue;
    }

    const current = result as { success?: boolean; pending?: boolean; error?: string };
    if (current.pending) anyPending = true;
    if (current.success) anySucceeded = true;
    if (!current.success) {
      allSucceeded = false;
      if (!current.pending) {
        firstError ||= current.error || 'One or more channels failed';
      }
    }
  }

  return {
    allSucceeded,
    anyPending,
    partialFailed: anySucceeded && Boolean(firstError),
    firstError,
    publishedChannels: getSuccessfulChannels(publishResults),
  };
}

/**
 * Apply the polled TikTok status to a single post doc, mirroring the
 * transitions the batch worker performs. Returns the resulting outcome so
 * callers (e.g. the publish routes) can branch on it without re-reading the
 * doc. Safe to call more than once: the terminal statuses only land when
 * TikTok reports them.
 */
export async function pollTikTokPublishForPost(
  workspaceId: string,
  postDocRef: DocumentReference,
): Promise<TikTokPostPollOutcome> {
  const snap = await postDocRef.get();
  if (!snap.exists) return { status: 'error', error: 'Post not found' };
  const post = snap.data() as Record<string, unknown>;
  const publishId = getTikTokPublishId(post);

  if (!publishId) return { status: 'no_external_id' };

  const productId = typeof post.productId === 'string' && post.productId ? post.productId : undefined;
  const connection = await getConnectionForChannel(
    workspaceId,
    'tiktok',
    productId,
  );
  if (!connection) return { status: 'no_connection' };

  let activeConnection = connection;
  if (isTikTokTokenExpiringSoon(activeConnection)) {
    activeConnection = (await refreshTikTokConnection(workspaceId, productId, activeConnection)) ?? activeConnection;
  }

  let liveStatus: Awaited<ReturnType<typeof fetchTikTokPublishStatus>>;
  try {
    liveStatus = await fetchTikTokPublishStatus(getAccessToken(activeConnection), publishId);
  } catch (err) {
    logger.warn('tiktok publish status fetch failed', {
      event: 'tiktok.publish.status_fetch_failed',
      workspaceId,
      postId: postDocRef.id,
      publishId,
      err,
    });
    return { status: 'error', error: err instanceof Error ? err.message : 'TikTok status fetch failed' };
  }
  if (isTikTokTokenInvalid(liveStatus.error)) {
    const refreshed = await refreshTikTokConnection(workspaceId, productId, activeConnection);
    if (refreshed) {
      activeConnection = refreshed;
      try {
        liveStatus = await fetchTikTokPublishStatus(getAccessToken(activeConnection), publishId);
      } catch (err) {
        logger.warn('tiktok publish status fetch failed after token refresh', {
          event: 'tiktok.publish.status_fetch_failed',
          workspaceId,
          postId: postDocRef.id,
          publishId,
          refreshed: true,
          err,
        });
        return { status: 'error', error: err instanceof Error ? err.message : 'TikTok status fetch failed' };
      }
    }
  }
  if (liveStatus.error) {
    logger.warn('tiktok publish status returned error', {
      event: 'tiktok.publish.status_error',
      workspaceId,
      postId: postDocRef.id,
      publishId,
      error: liveStatus.error,
    });
    return { status: 'error', error: liveStatus.error };
  }

  const now = new Date().toISOString();
  const clientId = getApiClientId(post);

  logger.info('tiktok publish status polled', {
    event: 'tiktok.publish.status',
    workspaceId,
    postId: postDocRef.id,
    publishId,
    status: liveStatus.status,
    publiclyAvailablePostId: liveStatus.publiclyAvailablePostId ?? null,
    ...(typeof liveStatus.downloadedBytes === 'number' ? { downloadedBytes: liveStatus.downloadedBytes } : {}),
    ...(typeof liveStatus.uploadedBytes === 'number' ? { uploadedBytes: liveStatus.uploadedBytes } : {}),
    ...(liveStatus.status === 'FAILED' && liveStatus.failReason ? { failReason: liveStatus.failReason } : {}),
  });

  // TikTok's `status` field never seems to transition away from
  // SEND_TO_USER_INBOX for content the creator finishes posting natively
  // from their TikTok app inbox (confirmed against real accounts: posts the
  // creator says they've already posted still report SEND_TO_USER_INBOX
  // indefinitely) — PUBLISH_COMPLETE appears to be reserved for TikTok's
  // own API-driven Direct Post flow. The reliable "it's actually live"
  // signal for the inbox hand-off is publiclyAvailablePostId showing up at
  // all (verified against video/list, which only lists truly-public
  // videos), so treat that as equivalent to PUBLISH_COMPLETE regardless of
  // what `status` still says.
  const publicPostId = firstTikTokPublicPostId(liveStatus.publiclyAvailablePostId);
  const inboxPostWentLive = liveStatus.status === 'SEND_TO_USER_INBOX' && Boolean(publicPostId);

  if (liveStatus.status === 'PUBLISH_COMPLETE' || inboxPostWentLive) {
    const analyticsExternalId = publicPostId || publishId;
    const nextPublishResults = withUpdatedTikTokResult(
      post.publishResults,
      'success',
      undefined,
      analyticsExternalId,
    );
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.allSucceeded ? 'published' : summary.anyPending ? 'publishing' : summary.partialFailed ? 'partial_failed' : 'failed';
    await postDocRef.update({
      status: nextStatus,
      ...(post.channel === 'tiktok' ? { externalId: analyticsExternalId } : {}),
      publishResults: nextPublishResults,
      tiktokPublishId: publishId,
      ...(publicPostId ? { tiktokPublicPostId: publicPostId } : {}),
      publishedChannels: summary.publishedChannels,
      ...(summary.allSucceeded ? { publishedAt: now } : {}),
      ...(summary.partialFailed ? { retryFailedChannelsOnly: true } : { retryFailedChannelsOnly: null }),
      errorMessage: !summary.allSucceeded && !summary.anyPending
        ? summary.firstError || 'One or more channels failed'
        : '',
      updatedAt: now,
    });
    if (clientId && nextStatus === 'published') {
      await incrementApiClientStat(workspaceId, clientId, 'publish_succeeded');
      await enqueueWebhookEvent(workspaceId, 'post.published', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        externalId: analyticsExternalId,
        externalUrl: typeof post.externalUrl === 'string' ? post.externalUrl : '',
      });
    } else if (clientId && (nextStatus === 'failed' || nextStatus === 'partial_failed')) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
      await enqueueWebhookEvent(workspaceId, 'post.failed', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        error: summary.firstError || 'One or more channels failed',
      });
    }
    return nextStatus === 'published'
      ? { status: 'published' }
      : nextStatus === 'partial_failed'
        ? { status: 'partial_failed', error: summary.firstError || 'One or more channels failed' }
        : nextStatus === 'failed'
        ? { status: 'failed', error: summary.firstError || 'One or more channels failed' }
        : { status: 'still_processing' };
  }

  // A Direct Post terminates at PUBLISH_COMPLETE, never in the creator's
  // inbox. If TikTok reports SEND_TO_USER_INBOX for one anyway, the post is
  // not waiting on the creator and must not be labelled as such — telling
  // them to "finish posting in the TikTok app" would send them looking for a
  // draft that isn't there. Keep polling instead and record the anomaly.
  if (liveStatus.status === 'SEND_TO_USER_INBOX' && !inboxPostWentLive && isTikTokDirectPost(post)) {
    logger.warn('tiktok direct post reported inbox delivery', {
      event: 'tiktok.publish.direct_post_inbox_status',
      workspaceId,
      postId: postDocRef.id,
      publishId,
    });
    await postDocRef.update({
      publishResults: withUpdatedTikTokResult(post.publishResults, 'pending'),
      tiktokLastStatus: liveStatus.status,
      tiktokPublishId: publishId,
      updatedAt: now,
    });
    return { status: 'still_processing' };
  }

  // MEDIA_UPLOAD mode always terminates at SEND_TO_USER_INBOX: the creator
  // finalizes caption/privacy and posts from the TikTok app. Only handled
  // here while genuinely still pending — inboxPostWentLive above already
  // routed the "creator finished it" case into the PUBLISH_COMPLETE branch.
  if (liveStatus.status === 'SEND_TO_USER_INBOX' && !inboxPostWentLive) {
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'success');
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.allSucceeded ? PLATFORM_ACTION_REQUIRED_STATUS : summary.anyPending ? 'publishing' : summary.partialFailed ? 'partial_failed' : 'failed';
    // Posts already sitting in platform_action_required get re-polled (see
    // pollPendingTikTokPublishes) so a creator who finishes posting from
    // their TikTok inbox is still detected. Keep actionRequiredAt fixed at
    // the original hand-off time on those re-polls — the re-poll window is
    // bounded by this field's age, so refreshing it on every poll would
    // keep a stuck post eligible forever instead of aging out.
    const alreadyActionRequired = post.status === PLATFORM_ACTION_REQUIRED_STATUS;
    await postDocRef.update({
      status: nextStatus,
      ...(nextStatus === PLATFORM_ACTION_REQUIRED_STATUS ? {
        nextAction: TIKTOK_MANUAL_PUBLISH_ACTION,
        ...(alreadyActionRequired ? {} : { actionRequiredAt: now }),
      } : {}),
      tiktokPublishId: publishId,
      ...(summary.partialFailed ? { retryFailedChannelsOnly: true } : { retryFailedChannelsOnly: null }),
      publishResults: nextPublishResults,
      publishedChannels: summary.publishedChannels,
      errorMessage: !summary.allSucceeded && !summary.anyPending
        ? summary.firstError || 'One or more channels failed'
        : '',
      updatedAt: now,
    });
    // The video is in the creator's TikTok inbox and cannot go live until they
    // post it from the app. Nothing else tells them, so email the prompt.
    if (nextStatus === PLATFORM_ACTION_REQUIRED_STATUS) {
      await sendTikTokInboxEmail(workspaceId, snap.id, post);
    }

    if (clientId && nextStatus === PLATFORM_ACTION_REQUIRED_STATUS) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_action_required');
      await enqueueWebhookEvent(workspaceId, 'post.action_required', {
        postId: snap.id,
        channel: post.channel,
        status: PLATFORM_ACTION_REQUIRED_STATUS,
        externalId: publishId,
        externalUrl: typeof post.externalUrl === 'string' ? post.externalUrl : '',
        nextAction: TIKTOK_MANUAL_PUBLISH_ACTION,
      });
    } else if (clientId && (nextStatus === 'failed' || nextStatus === 'partial_failed')) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
      await enqueueWebhookEvent(workspaceId, 'post.failed', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        error: summary.firstError || 'One or more channels failed',
      });
    }
    return nextStatus === PLATFORM_ACTION_REQUIRED_STATUS
      ? { status: PLATFORM_ACTION_REQUIRED_STATUS }
      : nextStatus === 'partial_failed'
        ? { status: 'partial_failed', error: summary.firstError || 'One or more channels failed' }
        : nextStatus === 'failed'
          ? { status: 'failed', error: summary.firstError || 'One or more channels failed' }
          : { status: 'still_processing' };
  }

  if (liveStatus.status === 'FAILED') {
    const error = `TikTok publish failed: ${liveStatus.failReason || 'Unknown TikTok failure'}`;
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'failed', error);
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.anyPending ? 'publishing' : summary.allSucceeded ? 'published' : summary.partialFailed ? 'partial_failed' : 'failed';
    await postDocRef.update({
      status: nextStatus,
      errorMessage: summary.firstError || error,
      publishResults: nextPublishResults,
      tiktokPublishId: publishId,
      publishedChannels: summary.publishedChannels,
      ...(nextStatus === 'published' ? { publishedAt: now } : {}),
      ...(summary.partialFailed ? { retryFailedChannelsOnly: true } : { retryFailedChannelsOnly: null }),
      updatedAt: now,
    });
    if (clientId && (nextStatus === 'failed' || nextStatus === 'partial_failed')) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
      await enqueueWebhookEvent(workspaceId, 'post.failed', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        error: summary.firstError || error,
      });
    }
    return nextStatus === 'failed'
      ? { status: 'failed', error: summary.firstError || error }
      : nextStatus === 'partial_failed'
        ? { status: 'partial_failed', error: summary.firstError || error }
      : nextStatus === 'published'
        ? { status: 'published' }
        : { status: 'still_processing' };
  }

  if (
    (liveStatus.status === 'PROCESSING_DOWNLOAD' || liveStatus.status === 'PROCESSING_UPLOAD') &&
    isPastTikTokPullTimeout(post)
  ) {
    const bytes =
      typeof liveStatus.downloadedBytes === 'number'
        ? ` downloadedBytes=${liveStatus.downloadedBytes}`
        : typeof liveStatus.uploadedBytes === 'number'
          ? ` uploadedBytes=${liveStatus.uploadedBytes}`
          : '';
    const error = `TikTok did not finish media transfer within the one-hour processing window.${bytes}`;
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'failed', error);
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.partialFailed ? 'partial_failed' : 'failed';
    await postDocRef.update({
      status: nextStatus,
      errorMessage: summary.firstError || error,
      publishResults: nextPublishResults,
      publishedChannels: summary.publishedChannels,
      publishFinishedAt: now,
      publishLeaseExpiresAt: null,
      ...(summary.partialFailed ? { retryFailedChannelsOnly: true } : { retryFailedChannelsOnly: null }),
      tiktokLastStatus: liveStatus.status,
      tiktokPublishId: publishId,
      ...(typeof liveStatus.downloadedBytes === 'number' ? { tiktokDownloadedBytes: liveStatus.downloadedBytes } : {}),
      ...(typeof liveStatus.uploadedBytes === 'number' ? { tiktokUploadedBytes: liveStatus.uploadedBytes } : {}),
      updatedAt: now,
    });
    if (clientId) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
      await enqueueWebhookEvent(workspaceId, 'post.failed', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        error: summary.firstError || error,
      });
    }
    return nextStatus === 'partial_failed'
      ? { status: 'partial_failed', error: summary.firstError || error }
      : { status: 'failed', error: summary.firstError || error };
  }

  await postDocRef.update({
    publishResults: withUpdatedTikTokResult(post.publishResults, 'pending'),
    tiktokLastStatus: liveStatus.status || null,
    tiktokPublishId: publishId,
    ...(typeof liveStatus.downloadedBytes === 'number' ? { tiktokDownloadedBytes: liveStatus.downloadedBytes } : {}),
    ...(typeof liveStatus.uploadedBytes === 'number' ? { tiktokUploadedBytes: liveStatus.uploadedBytes } : {}),
    updatedAt: now,
  });
  return { status: 'still_processing' };
}

/**
 * Poll TikTok for a single post with short retries, returning as soon as the
 * post reaches a terminal state (platform_action_required / published / failed) or
 * the budget is exhausted. Intended to be called inline from publish routes
 * so local / dev environments without Cloud Scheduler still transition
 * quickly out of `publishing`.
 */
export async function pollTikTokPublishWithRetries(
  workspaceId: string,
  postId: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<TikTokPostPollOutcome> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const intervalMs = Math.max(0, options.intervalMs ?? 3_000);
  const ref = adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`);

  let last: TikTokPostPollOutcome = { status: 'still_processing' };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    last = await pollTikTokPublishForPost(workspaceId, ref);
    if (last.status !== 'still_processing') return last;
  }
  return last;
}

/**
 * Resolve the post(s) currently associated with a TikTok publish_id. Used by
 * the webhook handler — TikTok only gives us the publish_id, so we have to
 * look up which post (and workspace) it belongs to. Returns at most one match
 * because publish_ids are globally unique within TikTok.
 */
export async function findPostByTikTokPublishId(publishId: string): Promise<{
  workspaceId: string;
  postRef: DocumentReference;
} | null> {
  if (!publishId) return null;

  const mappingSnap = await getTikTokPublishMappingRef(publishId).get();
  if (mappingSnap.exists) {
    const mapping = mappingSnap.data() as Record<string, unknown>;
    const workspaceId = typeof mapping.workspaceId === 'string' ? mapping.workspaceId : '';
    const postId = typeof mapping.postId === 'string' ? mapping.postId : '';
    if (workspaceId && postId) {
      return {
        workspaceId,
        postRef: adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`),
      };
    }
  }

  const byTikTokIdSnap = await adminDb
    .collectionGroup('posts')
    .where('tiktokPublishId', '==', publishId)
    .limit(5)
    .get();
  for (const doc of byTikTokIdSnap.docs) {
    const post = doc.data() as Record<string, unknown>;
    if (!postTargetsTikTok(post)) continue;
    const workspaceId = doc.ref.parent.parent?.id;
    if (workspaceId) return { workspaceId, postRef: doc.ref };
  }

  const byExternalIdSnap = await adminDb
    .collectionGroup('posts')
    .where('externalId', '==', publishId)
    .limit(5)
    .get();
  for (const doc of byExternalIdSnap.docs) {
    const post = doc.data() as Record<string, unknown>;
    if (!postTargetsTikTok(post)) continue;
    // posts live at workspaces/{workspaceId}/posts/{postId}
    const workspaceId = doc.ref.parent.parent?.id;
    if (workspaceId) return { workspaceId, postRef: doc.ref };
  }

  return null;
}

// TikTok's inbox hand-off (SEND_TO_USER_INBOX) has no webhook back to us —
// the creator must open the TikTok app and finish posting themselves.
// Without a re-poll, a post that's actually been finished on TikTok's side
// stays stuck at platform_action_required forever: its externalId is never
// swapped for the real numeric video ID, so it's excluded from analytics
// (status must be 'published') and metrics can never be fetched for it.
// Re-poll recently-handed-off posts for a window past TikTok's own ~7-day
// inbox draft expiry, then let them age out — actionRequiredAt is held
// fixed across re-polls (see pollTikTokPublishForPost) so this bound holds.
const TIKTOK_INBOX_REPOLL_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export async function pollPendingTikTokPublishes(): Promise<TikTokPublishPollResult> {
  const result: TikTokPublishPollResult = { polled: 0, completed: 0, failed: 0, pending: 0, errors: [] };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const candidates: Array<{
    workspaceId: string;
    postId: string;
    postRef: DocumentReference;
    mappingRef: DocumentReference;
    scheduleState: Record<string, unknown>;
  }> = [];
  const seenPosts = new Set<string>();
  const invalidMappingRefs: DocumentReference[] = [];

  // New publishes register one top-level due record, so discovery is O(due)
  // instead of O(all workspaces). During the rollout, reserve ten slots for
  // legacy posts that predate the mapping queue and migrate them as they poll.
  const reserveLegacySlots = now < LEGACY_TIKTOK_DISCOVERY_UNTIL_MS ? 10 : 0;
  let mappingQueryFailed = false;
  const dueMappings = await adminDb.collection('tiktok_publish_mappings')
    .where('pollStatus', '==', 'active')
    .where('nextPollAt', '<=', nowIso)
    .orderBy('nextPollAt', 'asc')
    .limit(MAX_TIKTOK_POLLS_PER_TICK - reserveLegacySlots)
    .get()
    .catch((error) => {
      mappingQueryFailed = true;
      logger.warn('TikTok mapping due query unavailable; using compatibility discovery', {
        event: 'tiktok.publish.mapping_query_fallback',
        err: error,
      });
      return null;
    });

  for (const mappingDoc of dueMappings?.docs ?? []) {
    const mapping = mappingDoc.data() as Record<string, unknown>;
    const workspaceId = typeof mapping.workspaceId === 'string' ? mapping.workspaceId : '';
    const postId = typeof mapping.postId === 'string' ? mapping.postId : '';
    if (!workspaceId || !postId) {
      invalidMappingRefs.push(mappingDoc.ref);
      continue;
    }
    const key = `${workspaceId}:${postId}`;
    if (seenPosts.has(key)) continue;
    seenPosts.add(key);
    candidates.push({
      workspaceId,
      postId,
      postRef: adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`),
      mappingRef: mappingDoc.ref,
      scheduleState: {
        status: mapping.pollMode === 'inbox' ? PLATFORM_ACTION_REQUIRED_STATUS : 'publishing',
        tiktokPollMode: mapping.pollMode === 'inbox' ? 'inbox' : 'active',
        tiktokPollAttemptCount: Number(mapping.pollAttemptCount) || 0,
        tiktokPollStartedAt: typeof mapping.createdAt === 'string' ? mapping.createdAt : nowIso,
        tiktokPollWorkspaceId: workspaceId,
        tiktokPollPostId: postId,
        tiktokPublishId: mapping.publishId,
      },
    });
  }

  // A malformed mapping must not remain due forever and consume one of the
  // bounded queue slots on every tick.
  if (invalidMappingRefs.length > 0) {
    const invalidBatch = adminDb.batch();
    for (const ref of invalidMappingRefs) {
      invalidBatch.set(ref, {
        pollStatus: 'terminal',
        nextPollAt: FieldValue.delete(),
        terminalAt: nowIso,
        expiresAt: Timestamp.fromMillis(now + TIKTOK_MAPPING_TERMINAL_RETENTION_MS),
      }, { merge: true });
    }
    await invalidBatch.commit();
  }

  const mappingCandidateCount = candidates.length;

  if (mappingQueryFailed || reserveLegacySlots > 0) {
    const wsDocs = await getAllDocs('workspaces');
    const repollCutoffIso = new Date(now - TIKTOK_INBOX_REPOLL_WINDOW_MS).toISOString();
    const legacyLimit = mappingQueryFailed
      ? MAX_TIKTOK_POLLS_PER_TICK
      : reserveLegacySlots;

    for (const ws of wsDocs) {
      const legacyCandidatesAdded = candidates.length - mappingCandidateCount;
      const remaining = legacyLimit - legacyCandidatesAdded;
      if (remaining <= 0 || candidates.length >= MAX_TIKTOK_POLLS_PER_TICK) break;
      const workspaceId = ws.id;
      const [publishingSnap, actionRequiredSnap] = await Promise.all([
        adminDb
          .collection(`workspaces/${workspaceId}/posts`)
          .where('status', '==', 'publishing')
          .orderBy('updatedAt', 'asc')
          .limit(remaining)
          .get()
          .catch((error) => {
        logger.warn('tiktok publishing-status poll query failed', {
          event: 'tiktok.publish.poll_query_failed',
          workspaceId,
          query: 'publishing',
          err: error,
        });
        return null;
      }),
        adminDb
          .collection(`workspaces/${workspaceId}/posts`)
          .where('status', '==', PLATFORM_ACTION_REQUIRED_STATUS)
          .where('actionRequiredAt', '>=', repollCutoffIso)
          .orderBy('actionRequiredAt', 'asc')
          .limit(remaining)
          .get()
          .catch((error) => {
        logger.warn('tiktok action-required poll query failed', {
          event: 'tiktok.publish.poll_query_failed',
          workspaceId,
          query: 'platform_action_required',
          err: error,
        });
        return null;
      }),
      ]);

      for (const doc of [...(publishingSnap?.docs ?? []), ...(actionRequiredSnap?.docs ?? [])]) {
        if (
          candidates.length >= MAX_TIKTOK_POLLS_PER_TICK ||
          candidates.length - mappingCandidateCount >= legacyLimit
        ) break;
        const post = doc.data() as Record<string, unknown>;
        const publishId = getTikTokPublishId(post);
        const key = `${workspaceId}:${doc.id}`;
        if (seenPosts.has(key) || !postTargetsTikTok(post) || !publishId || !isTikTokPollDue(post)) continue;
        seenPosts.add(key);
        const pollMode = isTikTokDirectPost(post) ? 'active' : 'inbox';
        candidates.push({
          workspaceId,
          postId: doc.id,
          postRef: doc.ref,
          mappingRef: getTikTokPublishMappingRef(publishId),
          scheduleState: {
            ...post,
            tiktokPollMode: pollMode,
            tiktokPollStartedAt: getPublishStartedAt(post) || nowIso,
            tiktokPollWorkspaceId: workspaceId,
            tiktokPollPostId: doc.id,
            tiktokPublishId: publishId,
          },
        });
      }
    }
  }

  const due = candidates.slice(0, MAX_TIKTOK_POLLS_PER_TICK);
  let cursor = 0;
  const worker = async () => {
    while (cursor < due.length) {
      const candidate = due[cursor++];
      const { workspaceId, postId, postRef, mappingRef, scheduleState } = candidate;
      result.polled++;

      try {
        const outcome = await pollTikTokPublishForPost(workspaceId, postRef);
        await recordNextTikTokPoll(postRef, scheduleState, outcome, mappingRef);
        switch (outcome.status) {
          case 'published':
          case 'platform_action_required':
            result.completed++;
            break;
          case 'partial_failed':
          case 'failed':
            result.failed++;
            break;
          case 'no_external_id':
          case 'no_connection':
          case 'still_processing':
            result.pending++;
            break;
          case 'error':
            result.errors.push({ workspaceId, postId, error: outcome.error });
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown TikTok publish polling error';
        result.errors.push({ workspaceId, postId, error: message });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(TIKTOK_POLL_CONCURRENCY, due.length) }, () => worker()),
  );

  return result;
}
