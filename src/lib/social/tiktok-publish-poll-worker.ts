import { adminDb } from '@/lib/firebase-admin';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { fetchTikTokPublishStatus } from '@/lib/platform/adapters/tiktok-publishing';
import { incrementApiClientStat } from '@/lib/public-api/analytics';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import type { SocialChannel } from '@/lib/schemas';
import { getAllDocs, getAllMatchingDocs } from '@/lib/firestore-pagination';
import type { DocumentReference } from 'firebase-admin/firestore';

type TikTokPublishPollResult = {
  polled: number;
  completed: number;
  failed: number;
  pending: number;
  errors: Array<{ workspaceId: string; postId: string; error: string }>;
};

export type TikTokPostPollOutcome =
  | { status: 'no_external_id' }
  | { status: 'no_connection' }
  | { status: 'still_processing' }
  | { status: 'exported_for_review' }
  | { status: 'published' }
  | { status: 'failed'; error: string }
  | { status: 'error'; error: string };

function getApiClientId(post: Record<string, unknown>) {
  return post.createdByType === 'api_client' && typeof post.createdById === 'string'
    ? post.createdById
    : null;
}

function withUpdatedTikTokResult(
  publishResults: unknown,
  status: 'success' | 'failed' | 'pending',
  error?: string,
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
      ...(error ? { error } : {}),
    },
  ];
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
  firstError?: string;
  publishedChannels: SocialChannel[];
} {
  if (!Array.isArray(publishResults) || publishResults.length === 0) {
    return { allSucceeded: false, anyPending: false, firstError: 'Missing publish results', publishedChannels: [] };
  }

  let anyPending = false;
  let allSucceeded = true;
  let firstError: string | undefined;

  for (const result of publishResults) {
    if (!result || typeof result !== 'object') {
      allSucceeded = false;
      firstError ||= 'Malformed publish result';
      continue;
    }

    const current = result as { success?: boolean; pending?: boolean; error?: string };
    if (current.pending) anyPending = true;
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

  if (!post.externalId) return { status: 'no_external_id' };

  const connection = await getConnectionForChannel(
    workspaceId,
    'tiktok',
    typeof post.productId === 'string' && post.productId ? post.productId : undefined,
  );
  if (!connection) return { status: 'no_connection' };

  let liveStatus: Awaited<ReturnType<typeof fetchTikTokPublishStatus>>;
  try {
    liveStatus = await fetchTikTokPublishStatus(getAccessToken(connection), String(post.externalId));
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'TikTok status fetch failed' };
  }
  if (liveStatus.error) return { status: 'error', error: liveStatus.error };

  const now = new Date().toISOString();
  const clientId = getApiClientId(post);

  if (liveStatus.status === 'PUBLISH_COMPLETE') {
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'success');
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.allSucceeded ? 'published' : summary.anyPending ? 'publishing' : 'failed';
    await postDocRef.update({
      status: nextStatus,
      publishResults: nextPublishResults,
      publishedChannels: summary.publishedChannels,
      ...(summary.allSucceeded ? { publishedAt: now } : {}),
      ...(!summary.allSucceeded && !summary.anyPending
        ? { errorMessage: summary.firstError || 'One or more channels failed' }
        : {}),
      updatedAt: now,
    });
    if (clientId && nextStatus === 'published') {
      await incrementApiClientStat(workspaceId, clientId, 'publish_succeeded');
      await enqueueWebhookEvent(workspaceId, 'post.published', {
        postId: snap.id,
        channel: post.channel,
        status: nextStatus,
        externalId: typeof post.externalId === 'string' ? post.externalId : '',
        externalUrl: typeof post.externalUrl === 'string' ? post.externalUrl : '',
      });
    } else if (clientId && nextStatus === 'failed') {
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
      : nextStatus === 'failed'
        ? { status: 'failed', error: summary.firstError || 'One or more channels failed' }
        : { status: 'still_processing' };
  }

  // MEDIA_UPLOAD mode always terminates at SEND_TO_USER_INBOX — the
  // creator finalizes caption/privacy and posts from the TikTok app.
  if (liveStatus.status === 'SEND_TO_USER_INBOX') {
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'success');
    const summary = summarizePublishResults(nextPublishResults);
    await postDocRef.update({
      status: 'exported_for_review',
      nextAction: 'open_tiktok_inbox_and_complete_editing',
      exportedForReviewAt: now,
      publishResults: nextPublishResults,
      publishedChannels: summary.publishedChannels,
      updatedAt: now,
    });
    if (clientId) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_exported_for_review');
      await enqueueWebhookEvent(workspaceId, 'post.exported_for_review', {
        postId: snap.id,
        channel: post.channel,
        status: 'exported_for_review',
        externalId: typeof post.externalId === 'string' ? post.externalId : '',
        externalUrl: typeof post.externalUrl === 'string' ? post.externalUrl : '',
        nextAction: 'open_tiktok_inbox_and_complete_editing',
      });
    }
    return { status: 'exported_for_review' };
  }

  if (liveStatus.status === 'FAILED') {
    const error = `TikTok publish failed: ${liveStatus.failReason || 'Unknown TikTok failure'}`;
    const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'failed', error);
    const summary = summarizePublishResults(nextPublishResults);
    const nextStatus = summary.anyPending ? 'publishing' : summary.allSucceeded ? 'published' : 'failed';
    await postDocRef.update({
      status: nextStatus,
      errorMessage: summary.firstError || error,
      publishResults: nextPublishResults,
      publishedChannels: summary.publishedChannels,
      ...(nextStatus === 'published' ? { publishedAt: now } : {}),
      updatedAt: now,
    });
    if (clientId && nextStatus === 'failed') {
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
      : nextStatus === 'published'
        ? { status: 'published' }
        : { status: 'still_processing' };
  }

  await postDocRef.update({
    publishResults: withUpdatedTikTokResult(post.publishResults, 'pending'),
    updatedAt: now,
  });
  return { status: 'still_processing' };
}

/**
 * Poll TikTok for a single post with short retries, returning as soon as the
 * post reaches a terminal state (exported_for_review / published / failed) or
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

export async function pollPendingTikTokPublishes(): Promise<TikTokPublishPollResult> {
  const result: TikTokPublishPollResult = { polled: 0, completed: 0, failed: 0, pending: 0, errors: [] };
  const wsDocs = await getAllDocs('workspaces');

  for (const ws of wsDocs) {
    const workspaceId = ws.id;
    const postsDocs = await getAllMatchingDocs(
      adminDb
        .collection(`workspaces/${workspaceId}/posts`)
        .where('status', '==', 'publishing')
        .where('channel', '==', 'tiktok')
        .orderBy('updatedAt', 'asc'),
    );

    for (const doc of postsDocs) {
      const post = doc.data();
      if (!post.externalId) continue;

      result.polled++;

      try {
        const outcome = await pollTikTokPublishForPost(workspaceId, doc.ref);
        switch (outcome.status) {
          case 'published':
            result.completed++;
            break;
          case 'exported_for_review':
            result.completed++;
            break;
          case 'failed':
            result.failed++;
            break;
          case 'no_external_id':
          case 'no_connection':
          case 'still_processing':
            result.pending++;
            break;
          case 'error':
            result.errors.push({ workspaceId, postId: doc.id, error: outcome.error });
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown TikTok publish polling error';
        result.errors.push({ workspaceId, postId: doc.id, error: message });
      }
    }
  }

  return result;
}
