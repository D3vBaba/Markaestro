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

    // Only draft or scheduled posts can be published
    if (post.status !== 'draft' && post.status !== 'scheduled') {
      return apiOk({ ok: false, error: `Cannot publish a post with status "${post.status}"` }, 400);
    }

    // Mark as publishing
    await ref.update({ status: 'publishing', updatedAt: new Date().toISOString() });

    const result = await publishPost(ctx.workspaceId, productId, {
      content: post.content,
      channel: post.channel,
      mediaUrls: post.mediaUrls,
    });

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
