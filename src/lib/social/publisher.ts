import { adminDb } from '@/lib/firebase-admin';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { getConnectionForChannel } from '@/lib/platform/connections';
import type { PublishRequest, PublishResult } from '@/lib/platform/types';

export type { PublishRequest, PublishResult };

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

    if (!productId) {
      results.push({ postId, success: false, error: 'Post has no associated product' });
      continue;
    }

    await doc.ref.update({ status: 'publishing', updatedAt: new Date().toISOString() });

    const result = await publishPost(workspaceId, productId, {
      content: post.content,
      channel: post.channel,
      mediaUrls: post.mediaUrls,
    });

    if (result.success) {
      await doc.ref.update({
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await doc.ref.update({
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
        updatedAt: new Date().toISOString(),
      });
    }

    results.push({ postId, success: result.success, error: result.error });
  }

  return { processed: results.length, results };
}
