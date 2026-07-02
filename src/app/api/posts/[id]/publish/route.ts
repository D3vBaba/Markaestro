import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  claimPostForImmediatePublish,
  finalizeFailedPublish,
  finalizeSuccessfulPublish,
  getPostTargetChannels,
  persistTikTokPendingPublish,
  publishStoredPost,
} from '@/lib/social/publisher';
import { pollTikTokPublishWithRetries } from '@/lib/social/tiktok-publish-poll-worker';
import { PLATFORM_ACTION_REQUIRED_STATUS, TIKTOK_MANUAL_PUBLISH_ACTION } from '@/lib/tiktok-draft-flow';
import { logger } from '@/lib/logger';
import { formatPreflightIssues, getSocialPostPreflightIssues } from '@/lib/social/post-preflight';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIKTOK_INLINE_POLL_ATTEMPTS = 10;
const TIKTOK_INLINE_POLL_INTERVAL_MS = 5_000;

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
      result = await publishStoredPost(ctx.workspaceId, productId, post, {
        onChannelResult: (channelResult) => persistTikTokPendingPublish(
          ctx.workspaceId,
          claim.claimed,
          targetChannels,
          channelResult,
        ),
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

      // TikTok's init call hands us a publish_id before the creator inbox
      // handoff is complete. Poll across the normal 15–45s TikTok processing
      // window so the in-app publish button usually returns with the inbox
      // action ready instead of leaving the post stuck in `publishing`.
      let finalStatus: 'publishing' | 'platform_action_required' | 'published' | 'failed' | 'partial_failed' = 'publishing';
      let inlineError: string | undefined;
      if (targetChannels.includes('tiktok')) {
        const outcome = await pollTikTokPublishWithRetries(ctx.workspaceId, id, {
          attempts: TIKTOK_INLINE_POLL_ATTEMPTS,
          intervalMs: TIKTOK_INLINE_POLL_INTERVAL_MS,
        });
        if (outcome.status === PLATFORM_ACTION_REQUIRED_STATUS) finalStatus = PLATFORM_ACTION_REQUIRED_STATUS;
        else if (outcome.status === 'published') finalStatus = 'published';
        else if (outcome.status === 'partial_failed') {
          finalStatus = 'partial_failed';
          inlineError = outcome.error;
        }
        else if (outcome.status === 'failed') {
          finalStatus = 'failed';
          inlineError = outcome.error;
        }
        logger.info('tiktok inline publish poll finished', {
          event: 'posts.publish.tiktok_inline_poll',
          workspaceId: ctx.workspaceId,
          postId: id,
          outcome: outcome.status,
          attempts: TIKTOK_INLINE_POLL_ATTEMPTS,
          intervalMs: TIKTOK_INLINE_POLL_INTERVAL_MS,
          ...(inlineError ? { error: inlineError } : {}),
        });
      }

      return apiOk({
        ok: finalStatus !== 'failed' && finalStatus !== 'partial_failed',
        id,
        status: finalStatus,
        pending: finalStatus === 'publishing',
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        nextAction: finalStatus === PLATFORM_ACTION_REQUIRED_STATUS ? TIKTOK_MANUAL_PUBLISH_ACTION : undefined,
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
