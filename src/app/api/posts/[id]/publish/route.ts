import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { publishPost } from '@/lib/social/publisher';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const post = snap.data()!;
    const productId = post.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'Post has no associated product' }, 400);
    }

    // Only draft, scheduled, or failed posts can be published
    if (post.status !== 'draft' && post.status !== 'scheduled' && post.status !== 'failed') {
      return apiOk({ ok: false, error: `Cannot publish a post with status "${post.status}"` }, 400);
    }

    // Mark as publishing
    await ref.update({ status: 'publishing', updatedAt: new Date().toISOString() });

    console.log(`[publish] Post ${id}: channel=${post.channel}, productId=${productId}, mediaUrls=${JSON.stringify(post.mediaUrls)}`);

    let result;
    try {
      result = await publishPost(ctx.workspaceId, productId, {
        content: post.content,
        channel: post.channel,
        mediaUrls: post.mediaUrls,
      });
    } catch (publishError) {
      // Unexpected exception — revert so post doesn't stay stuck in 'publishing'
      const msg = publishError instanceof Error ? publishError.message : 'Internal publishing error';
      await ref.update({ status: 'failed', errorMessage: msg, updatedAt: new Date().toISOString() });
      console.error(`[publish] Exception for ${id}:`, publishError);
      return apiOk({ ok: false, id, status: 'failed', error: msg });
    }

    console.log(`[publish] Result for ${id}:`, JSON.stringify(result));

    if (result.success) {
      await ref.update({
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return apiOk({ ok: true, id, status: 'published', externalId: result.externalId, externalUrl: result.externalUrl });
    } else {
      await ref.update({
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
        updatedAt: new Date().toISOString(),
      });
      return apiOk({ ok: false, id, status: 'failed', error: result.error });
    }
  } catch (error) {
    return apiError(error);
  }
}
