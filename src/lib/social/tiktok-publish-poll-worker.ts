import { adminDb } from '@/lib/firebase-admin';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { fetchTikTokPublishStatus } from '@/lib/platform/adapters/tiktok-publishing';
import type { SocialChannel } from '@/lib/schemas';
import { getAllDocs, getAllMatchingDocs } from '@/lib/firestore-pagination';

type TikTokPublishPollResult = {
  polled: number;
  completed: number;
  failed: number;
  pending: number;
  errors: Array<{ workspaceId: string; postId: string; error: string }>;
};

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
        const connection = await getConnectionForChannel(workspaceId, 'tiktok', post.productId as string | undefined);
        if (!connection) {
          throw new Error('TikTok connection not found while polling publish status');
        }

        const status = await fetchTikTokPublishStatus(getAccessToken(connection), String(post.externalId));
        if (status.error) {
          throw new Error(status.error);
        }

        if (status.status === 'PUBLISH_COMPLETE') {
          const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'success');
          const summary = summarizePublishResults(nextPublishResults);
          const nextStatus = summary.allSucceeded ? 'published' : summary.anyPending ? 'publishing' : 'failed';
          await doc.ref.update({
            status: nextStatus,
            publishResults: nextPublishResults,
            publishedChannels: summary.publishedChannels,
            ...(summary.allSucceeded ? { publishedAt: new Date().toISOString() } : {}),
            ...(!summary.allSucceeded && !summary.anyPending ? { errorMessage: summary.firstError || 'One or more channels failed' } : {}),
            updatedAt: new Date().toISOString(),
          });
          if (nextStatus === 'published') result.completed++;
          else if (nextStatus === 'failed') result.failed++;
          else result.pending++;
          continue;
        }

        // MEDIA_UPLOAD mode always terminates at SEND_TO_USER_INBOX — the
        // creator finalizes caption/privacy and posts from the TikTok app.
        if (status.status === 'SEND_TO_USER_INBOX') {
          const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'success');
          const summary = summarizePublishResults(nextPublishResults);
          const now = new Date().toISOString();
          await doc.ref.update({
            status: 'exported_for_review',
            nextAction: 'open_tiktok_inbox_and_complete_editing',
            exportedForReviewAt: now,
            publishResults: nextPublishResults,
            publishedChannels: summary.publishedChannels,
            updatedAt: now,
          });
          result.completed++;
          continue;
        }

        if (status.status === 'FAILED') {
          const error = `TikTok publish failed: ${status.failReason || 'Unknown TikTok failure'}`;
          const nextPublishResults = withUpdatedTikTokResult(post.publishResults, 'failed', error);
          const summary = summarizePublishResults(nextPublishResults);
          const nextStatus = summary.anyPending ? 'publishing' : summary.allSucceeded ? 'published' : 'failed';
          await doc.ref.update({
            status: nextStatus,
            errorMessage: summary.firstError || error,
            publishResults: nextPublishResults,
            publishedChannels: summary.publishedChannels,
            ...(nextStatus === 'published' ? { publishedAt: new Date().toISOString() } : {}),
            updatedAt: new Date().toISOString(),
          });
          if (nextStatus === 'published') result.completed++;
          else if (nextStatus === 'failed') result.failed++;
          else result.pending++;
          continue;
        }

        await doc.ref.update({
          publishResults: withUpdatedTikTokResult(post.publishResults, 'pending'),
          updatedAt: new Date().toISOString(),
        });
        result.pending++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown TikTok publish polling error';
        result.errors.push({ workspaceId, postId: doc.id, error: message });
      }
    }
  }

  return result;
}
