import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  claimPostForImmediatePublish,
  classifyPublishError,
  finalizeFailedPublish,
  finalizeManualReminderPublish,
  finalizeSuccessfulPublish,
  getPostChannelDeliveryMode,
  getPostTargetChannels,
  isFullyManualReminderPost,
  persistTikTokPendingPublish,
  publishStoredPost,
} from '@/lib/social/publisher';
import { pollTikTokPublishWithRetries } from '@/lib/social/tiktok-publish-poll-worker';
import { PLATFORM_ACTION_REQUIRED_STATUS, TIKTOK_MANUAL_PUBLISH_ACTION } from '@/lib/tiktok-draft-flow';
import { isManualReminderDeliveryMode } from '@/lib/manual-publish-flow';
import { logger } from '@/lib/logger';
import { formatPreflightIssues, getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { finishPublishRun, startPublishRun } from '@/lib/social/publish-run-records';
import { RATE_LIMITS, applyRateLimit, checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIKTOK_INLINE_POLL_ATTEMPTS = 10;
const TIKTOK_INLINE_POLL_INTERVAL_MS = 5_000;

type ChannelResults = Array<Record<string, unknown>>;

function publicPublishError(error: unknown): string | undefined {
  return typeof error === 'string' && error
    ? classifyPublishError(error).code
    : undefined;
}

function publicChannelResults(results: ChannelResults): ChannelResults {
  return results.map((result) => {
    const code = publicPublishError(result.error);
    if (!code) {
      const safeResult = { ...result };
      delete safeResult.error;
      return safeResult;
    }
    return { ...result, error: code };
  });
}

/**
 * The inline TikTok poll updates the post's `publishResults` in Firestore, so
 * the snapshot captured before the poll can still show TikTok as
 * `success: false, pending: true` after the post has actually published. The
 * response must carry the post-poll results — a stale `success: false` with no
 * `error` renders as "tiktok: undefined" in the composer.
 */
async function getFreshChannelResults(
  workspaceId: string,
  postId: string,
  fallback: ChannelResults,
): Promise<ChannelResults> {
  try {
    const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
    const publishResults = snap.data()?.publishResults;
    if (Array.isArray(publishResults) && publishResults.length > 0) {
      return publishResults as ChannelResults;
    }
  } catch (error) {
    logger.warn('post-poll channel result refresh failed', {
      event: 'posts.publish.channel_refresh_failed',
      workspaceId,
      postId,
      err: error,
    });
  }
  return fallback;
}

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

    // Workspace-scoped rather than uid-scoped, so a team cannot multiply the
    // ceiling by adding seats. This handler declares maxDuration 300, makes
    // outbound platform calls, uploads media, and can inline-poll TikTok for
    // ~50s, so it is the most expensive request a signed-in user can send.
    // The public API's equivalent, which only enqueues a job, was already
    // limited to 20/min while this did real work unmetered.
    await applyRateLimit(req, RATE_LIMITS.publish, { key: `publish:${ctx.workspaceId}` });

    // Longer-window ceiling per channel: 30 publishes per hour per channel per
    // workspace, which is the limit the platforms themselves care about, since
    // sustained bursts are what get app credentials restricted. Checked BEFORE
    // the claim below on purpose: the claim moves the post into `publishing`
    // and clears `scheduledAt`, so refusing after it would strand the post
    // until the lease expired. The plain read here can race an edit to the
    // channel list, which at worst lets one request past the hourly ceiling.
    {
      const preClaimSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`).get();
      if (preClaimSnap.exists) {
        const preClaim = preClaimSnap.data() as Record<string, unknown>;
        const channels = getPostTargetChannels(preClaim);
        for (const channel of channels) {
          const mode = getPostChannelDeliveryMode(preClaim, channel, preClaim.settings);
          // Manual channels never call a platform API, so they are exempt.
          if (isManualReminderDeliveryMode(mode)) continue;
          const account = await checkRateLimit(
            `publish-account:${ctx.workspaceId}:${channel}`,
            RATE_LIMITS.publishPerAccount,
          );
          if (!account.allowed) {
            return apiOk({
              ok: false,
              error: 'RATE_LIMITED_CHANNEL',
              channel,
              retryAfterSeconds: Math.max(1, Math.ceil((account.resetAt - Date.now()) / 1000)),
            }, 429);
          }
        }
      }
    }

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

    // Per-target: a post can be manual on one channel and automatic on
    // another, so `manualReminder` here means "every channel is manual".
    const manualChannels = targetChannels.filter((channel) =>
      isManualReminderDeliveryMode(getPostChannelDeliveryMode(post, channel, post.settings)),
    );
    const manualReminder = isFullyManualReminderPost(post, targetChannels);

    // productId is optional for TikTok-only posts (UGC pipeline creates posts without a product link)
    // and for manual reminder posts (no platform API call means no connection metadata is needed).
    // Other channels use product-scoped connection metadata such as selected pages, boards, or channels.
    if (!productId && !manualReminder && targetChannels.some((channel) => channel !== 'tiktok')) {
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
      // Manual reminder channels don't need a connected/ready account —
      // nothing is sent to the platform, so only content validation applies.
      { requireReadyChannels: !manualReminder, manualChannels },
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

    // Every publish path now leaves a job_runs record, so the run history and
    // the webhook event stream do not depend on which surface started it.
    const runId = await startPublishRun({
      workspaceId: ctx.workspaceId,
      postId: id,
      source: 'app_immediate',
      channel: post.channel,
      createdByType: post.createdByType,
      createdById: ctx.uid,
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
      await finishPublishRun(ctx.workspaceId, runId, 'failed', msg);
      return apiOk({ ok: false, id, status: 'failed', error: 'INTERNAL_PUBLISH_ERROR' });
    }

    logger.info('publish finished', {
      event: 'posts.publish.finished',
      workspaceId: ctx.workspaceId,
      postId: id,
      pending: result.pending,
      channelResults: result.channels.map((c) => ({ channel: c.channel, success: c.success })),
    });

    // `actionRequired` means every channel is waiting on the user;
    // `partialActionRequired` means some published and some are waiting. Both
    // leave the post in the To Post queue, and the per-channel results tell
    // the composer which half is which. A split post that is also still
    // pending falls through to the pending branch, which the poll worker
    // finishes.
    if (result.actionRequired || (result.partialActionRequired && !result.pending)) {
      await finalizeManualReminderPublish(ctx.workspaceId, claim.claimed, result);
      await finishPublishRun(ctx.workspaceId, runId, 'action_required');
      return apiOk({
        ok: true,
        id,
        status: PLATFORM_ACTION_REQUIRED_STATUS,
        nextAction: result.nextAction,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        channels: publicChannelResults(result.channels as ChannelResults),
      });
    }

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

      // The inline poll may have moved TikTok past the pre-poll snapshot in
      // `result.channels`; only a terminal outcome makes re-reading worth it.
      const channels = finalStatus === 'publishing'
        ? result.channels
        : await getFreshChannelResults(ctx.workspaceId, id, result.channels as ChannelResults);

      // `publishing` means the poll worker still owns it, so the run stays
      // open; anything terminal closes it here.
      await finishPublishRun(
        ctx.workspaceId,
        runId,
        finalStatus === 'publishing' ? 'pending'
          : finalStatus === 'published' ? 'succeeded'
          : finalStatus === 'partial_failed' ? 'partial_failed'
          : finalStatus === PLATFORM_ACTION_REQUIRED_STATUS ? 'action_required'
          : 'failed',
        inlineError ?? '',
      );

      return apiOk({
        ok: finalStatus !== 'failed' && finalStatus !== 'partial_failed',
        id,
        status: finalStatus,
        pending: finalStatus === 'publishing',
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        nextAction: finalStatus === PLATFORM_ACTION_REQUIRED_STATUS ? TIKTOK_MANUAL_PUBLISH_ACTION : undefined,
        error: publicPublishError(inlineError),
        channels: publicChannelResults(channels),
      });
    }

    if (result.success) {
      const nextStatus = await finalizeSuccessfulPublish(ctx.workspaceId, claim.claimed, result);
      await finishPublishRun(ctx.workspaceId, runId, 'succeeded');
      return apiOk({
        ok: true,
        id,
        status: nextStatus,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        nextAction: result.nextAction,
        channels: publicChannelResults(result.channels as ChannelResults),
      });
    } else {
      const nextStatus = await finalizeFailedPublish(ctx.workspaceId, claim.claimed, result, { retryOnFailure: false });
      await finishPublishRun(
        ctx.workspaceId,
        runId,
        nextStatus === 'partial_failed' ? 'partial_failed' : 'failed',
        result.error ?? '',
      );
      return apiOk({
        ok: false,
        id,
        status: nextStatus,
        error: publicPublishError(result.error) ?? 'UNKNOWN_PUBLISH_ERROR',
        channels: publicChannelResults(result.channels as ChannelResults),
      });
    }
  } catch (error) {
    return apiError(error);
  }
}
