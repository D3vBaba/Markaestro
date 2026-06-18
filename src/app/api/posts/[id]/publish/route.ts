import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  claimPostForImmediatePublish,
  finalizeFailedPublish,
  finalizeSuccessfulPublish,
  getPostTargetChannels,
  publishStoredPost,
} from '@/lib/social/publisher';
import { pollTikTokPublishWithRetries } from '@/lib/social/tiktok-publish-poll-worker';
import { TIKTOK_MANUAL_REVIEW_ACTION } from '@/lib/tiktok-draft-flow';
import { logger } from '@/lib/logger';
import { formatPreflightIssues, getSocialPostPreflightIssues } from '@/lib/social/post-preflight';

export const runtime = 'nodejs';
export const maxDuration = 300;


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');

    // Outbound publishing is the one action gated on email verification.
    // Unverified users keep full read/draft/edit access elsewhere.
    if (!ctx.emailVerified) {
      return apiOk(
        { ok: false, code: 'EMAIL_NOT_VERIFIED', error: 'Verify your email to publish.' },
        403,
      );
    }

    const { id } = await params;

    const claim = await claimPostForImmediatePublish(ctx.workspaceId, id);
    if (!claim.ok) {
      return apiOk({ ok: false, error: claim.error }, claim.status);
    }

    const { post, productId } = claim.claimed;
    const targetChannels = getPostTargetChannels(post);
    const failedChannels = (message: string) => targetChannels.map((channel) => ({
      channel,
      success: false,
      error: message,
    }));

    // productId is optional for TikTok-only posts (UGC pipeline creates posts without a product link).
    // Other channels use product-scoped connection metadata such as selected pages, boards, or channels.
    if (!productId && targetChannels.some((channel) => channel !== 'tiktok')) {
      await finalizeFailedPublish(ctx.workspaceId, claim.claimed, {
        success: false,
        channels: failedChannels('Post has no associated product'),
        error: 'Post has no associated product',
      }, { retryOnFailure: false });
      return apiOk({ ok: false, error: 'Post has no associated product' }, 400);
    }

    const mediaUrls = Array.isArray(post.mediaUrls) ? post.mediaUrls.filter((url): url is string => typeof url === 'string') : [];
    const preflightIssues = await getSocialPostPreflightIssues(
      ctx.workspaceId,
      productId,
      {
        content: typeof post.content === 'string' ? post.content : '',
        channel: typeof post.channel === 'string' ? post.channel : undefined,
        targetChannels,
        mediaUrls,
      },
      { requireReadyChannels: true },
    );
    if (preflightIssues.length > 0) {
      const message = formatPreflightIssues(preflightIssues);
      await finalizeFailedPublish(ctx.workspaceId, claim.claimed, {
        success: false,
        channels: failedChannels(message),
        error: message,
      }, { retryOnFailure: false });
      return apiOk({ ok: false, error: message, issues: preflightIssues }, 400);
    }

    logger.info('publish started', {
      event: 'posts.publish.started',
      workspaceId: ctx.workspaceId,
      postId: id,
      channels: targetChannels,
      productId: productId ?? null,
      mediaCount: Array.isArray(post.mediaUrls) ? post.mediaUrls.length : 0,
    });

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
      const msg = publishError instanceof Error ? publishError.message : 'Internal publishing error';
      await finalizeFailedPublish(ctx.workspaceId, claim.claimed, {
        success: false,
        channels: failedChannels(msg),
        error: msg,
      }, { retryOnFailure: false });
      logger.error('publish failed', {
        event: 'posts.publish.exception',
        workspaceId: ctx.workspaceId,
        postId: id,
        err: publishError,
      });
      return apiOk({ ok: false, id, status: 'failed', error: msg });
    }

    logger.info('publish finished', {
      event: 'posts.publish.finished',
      workspaceId: ctx.workspaceId,
      postId: id,
      pending: result.pending,
      channelResults: result.channels.map((c) => ({ channel: c.channel, success: c.success })),
    });

    if (result.pending) {
      await finalizeSuccessfulPublish(ctx.workspaceId, claim.claimed, result);

      // TikTok's init call hands us a publish_id but the transcode into the
      // creator's inbox usually finishes in 15–45s. In prod this is picked
      // up by the 1-min Cloud Scheduler poll worker; locally / in dev that
      // isn't running, so short-poll inline before returning.
      let finalStatus: 'publishing' | 'exported_for_review' | 'published' | 'failed' | 'partial_failed' = 'publishing';
      let inlineError: string | undefined;
      if (targetChannels.includes('tiktok')) {
        const outcome = await pollTikTokPublishWithRetries(ctx.workspaceId, id);
        if (outcome.status === 'exported_for_review') finalStatus = 'exported_for_review';
        else if (outcome.status === 'published') finalStatus = 'published';
        else if (outcome.status === 'partial_failed') {
          finalStatus = 'partial_failed';
          inlineError = outcome.error;
        }
        else if (outcome.status === 'failed') {
          finalStatus = 'failed';
          inlineError = outcome.error;
        }
      }

      return apiOk({
        ok: finalStatus !== 'failed' && finalStatus !== 'partial_failed',
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
      const nextStatus = await finalizeSuccessfulPublish(ctx.workspaceId, claim.claimed, result);
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
      const nextStatus = await finalizeFailedPublish(ctx.workspaceId, claim.claimed, result, { retryOnFailure: false });
      return apiOk({
        ok: false,
        id,
        status: nextStatus,
        error: result.error,
        channels: result.channels,
      });
    }
  } catch (error) {
    return apiError(error);
  }
}
