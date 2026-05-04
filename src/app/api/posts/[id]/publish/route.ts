import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getPostTargetChannels, publishStoredPost } from '@/lib/social/publisher';
import { pollTikTokPublishWithRetries } from '@/lib/social/tiktok-publish-poll-worker';
import { TIKTOK_MANUAL_REVIEW_ACTION } from '@/lib/tiktok-draft-flow';

export const runtime = 'nodejs';
export const maxDuration = 300;


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const post = snap.data() as Record<string, unknown>;
    const productId = typeof post.productId === 'string' ? post.productId : undefined;
    const targetChannels = getPostTargetChannels(post);

    // productId is optional for TikTok-only posts (UGC pipeline creates posts without a product link).
    // Other channels use product-scoped connection metadata such as selected pages, boards, or channels.
    if (!productId && targetChannels.some((channel) => channel !== 'tiktok')) {
      return apiOk({ ok: false, error: 'Post has no associated product' }, 400);
    }

    // Allow draft, scheduled, failed, or already-staged review posts to be (re-)published.
    // exported_for_review re-pushes the asset to the TikTok inbox so the creator can
    // finalize and post from the TikTok app instead of staying parked in Markaestro.
    const publishableStatuses = ['draft', 'scheduled', 'failed', 'exported_for_review'];
    const status = typeof post.status === 'string' ? post.status : '';
    if (!publishableStatuses.includes(status)) {
      return apiOk({ ok: false, error: `Cannot publish a post with status "${post.status}"` }, 400);
    }

    // Mark as publishing. Clear any stale externalId from a prior inbox push so
    // the TikTok poll worker can't race against the in-flight re-publish using
    // the old publish_id from an earlier exported_for_review state. Also clear
    // scheduledAt so the UI doesn't render a stale "Scheduled" badge on a post
    // we're actively publishing now.
    await ref.update({
      status: 'publishing',
      externalId: '',
      errorMessage: '',
      scheduledAt: null,
      updatedAt: new Date().toISOString(),
    });

    console.log(`[publish] Post ${id}: channels=${targetChannels.join(',')}, productId=${productId}, mediaUrls=${JSON.stringify(post.mediaUrls)}`);

    let result;
    try {
      result = await publishStoredPost(ctx.workspaceId, productId, {
        ...post,
        // The UI Publish button is an explicit "push it now" action: even if
        // the post was originally created via a legacy user_review flow,
        // clicking Publish must override and push to the platform.
        deliveryMode: 'direct_publish',
      });
    } catch (publishError) {
      // Unexpected exception — revert so post doesn't stay stuck in 'publishing'
      const msg = publishError instanceof Error ? publishError.message : 'Internal publishing error';
      await ref.update({ status: 'failed', errorMessage: msg, updatedAt: new Date().toISOString() });
      console.error(`[publish] Exception for ${id}:`, publishError);
      return apiOk({ ok: false, id, status: 'failed', error: msg });
    }

    console.log(`[publish] Result for ${id}:`, JSON.stringify(result));

    const successfulChannels = result.channels.filter((c) => c.success);

    if (result.pending) {
      await ref.update({
        status: 'publishing',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        updatedAt: new Date().toISOString(),
      });

      // TikTok's init call hands us a publish_id but the transcode into the
      // creator's inbox usually finishes in 15–45s. In prod this is picked
      // up by the 1-min Cloud Scheduler poll worker; locally / in dev that
      // isn't running, so short-poll inline before returning.
      let finalStatus: 'publishing' | 'exported_for_review' | 'published' | 'failed' = 'publishing';
      let inlineError: string | undefined;
      if (targetChannels.includes('tiktok')) {
        const outcome = await pollTikTokPublishWithRetries(ctx.workspaceId, id);
        if (outcome.status === 'exported_for_review') finalStatus = 'exported_for_review';
        else if (outcome.status === 'published') finalStatus = 'published';
        else if (outcome.status === 'failed') {
          finalStatus = 'failed';
          inlineError = outcome.error;
        }
      }

      return apiOk({
        ok: finalStatus !== 'failed',
        id,
        status: finalStatus,
        pending: finalStatus === 'publishing',
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        nextAction: finalStatus === 'exported_for_review' ? TIKTOK_MANUAL_REVIEW_ACTION : undefined,
        error: inlineError,
        channels: result.channels,
      });
    }

    if (result.success) {
      const nextStatus = result.reviewRequired ? 'exported_for_review' : 'published';
      await ref.update({
        status: nextStatus,
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        publishedChannels: successfulChannels.map((c) => c.channel),
        ...(result.reviewRequired
          ? { nextAction: result.nextAction || TIKTOK_MANUAL_REVIEW_ACTION, exportedForReviewAt: new Date().toISOString() }
          : { publishedAt: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      });
      return apiOk({
        ok: true,
        id,
        status: nextStatus,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        nextAction: result.nextAction,
        channels: result.channels,
      });
    } else {
      await ref.update({
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
        publishResults: result.channels,
        updatedAt: new Date().toISOString(),
      });
      return apiOk({
        ok: false,
        id,
        status: 'failed',
        error: result.error,
        channels: result.channels,
      });
    }
  } catch (error) {
    return apiError(error);
  }
}
