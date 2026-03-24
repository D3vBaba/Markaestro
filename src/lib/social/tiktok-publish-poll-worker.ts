import { adminDb } from '@/lib/firebase-admin';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { fetchTikTokPublishStatus } from '@/lib/platform/adapters/tiktok-publishing';

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

export async function pollPendingTikTokPublishes(): Promise<TikTokPublishPollResult> {
  const result: TikTokPublishPollResult = { polled: 0, completed: 0, failed: 0, pending: 0, errors: [] };
  const wsSnap = await adminDb.collection('workspaces').limit(200).get();

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;
    const postsSnap = await adminDb
      .collection(`workspaces/${workspaceId}/posts`)
      .where('status', '==', 'publishing')
      .limit(50)
      .get();

    for (const doc of postsSnap.docs) {
      const post = doc.data();
      if (post.channel !== 'tiktok' || !post.externalId) continue;

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
          await doc.ref.update({
            status: 'published',
            publishResults: withUpdatedTikTokResult(post.publishResults, 'success'),
            publishedChannels: ['tiktok'],
            publishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          result.completed++;
          continue;
        }

        if (status.status === 'FAILED') {
          const error = `TikTok publish failed: ${status.failReason || 'Unknown TikTok failure'}`;
          await doc.ref.update({
            status: 'failed',
            errorMessage: error,
            publishResults: withUpdatedTikTokResult(post.publishResults, 'failed', error),
            updatedAt: new Date().toISOString(),
          });
          result.failed++;
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
