import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { isResettablePublishState, updatePostSchema } from '@/lib/schemas';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { assertPostMutable } from '@/lib/social/post-mutation-guards';
import { releasePostMedia, syncPostMediaReferences } from '@/lib/media/asset-store';
import { logger } from '@/lib/logger';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

export const runtime = 'nodejs';

/**
 * Fields that describe *what* gets published. Changing any of them means the
 * stored post no longer matches whatever was sent to the platform.
 */
const CONTENT_FIELDS = [
  'content',
  'channel',
  'targetChannels',
  'mediaUrls',
  'productId',
  'destinationProvider',
  'destinationId',
  'settings',
  'settingsByChannel',
] as const;


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    return apiOk({ id, ...snap.data() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const body = await req.json();
    const data = updatePostSchema.parse(body);

    // Moving a post into "scheduled" queues an outbound publish, so it requires
    // a verified email. Editing drafts/content stays open to unverified users.
    if (data.status === 'scheduled' && !ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to publish.' },
        403,
      );
    }

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const existing = snap.data() as Record<string, unknown>;
    assertPostMutable(existing, 'update');
    const nextPost = {
      ...existing,
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    };

    if (nextPost.status === 'scheduled') {
      const issues = await getSocialPostPreflightIssues(
        ctx.workspaceId,
        typeof nextPost.productId === 'string' && nextPost.productId ? nextPost.productId : undefined,
        {
          content: typeof nextPost.content === 'string' ? nextPost.content : '',
          channel: typeof nextPost.channel === 'string' ? nextPost.channel : undefined,
          targetChannels: Array.isArray(nextPost.targetChannels) ? nextPost.targetChannels : undefined,
          mediaUrls: Array.isArray(nextPost.mediaUrls) ? nextPost.mediaUrls.filter((url): url is string => typeof url === 'string') : undefined,
        },
        {
          requireReadyChannels: true,
          channelDestinations: nextPost.channelDestinations as
            | Record<string, string>
            | undefined,
        },
      );
      if (issues.length > 0) {
        return apiOk({ error: 'VALIDATION_ERROR', issues }, 400);
      }
    }

    // Strip undefined keys so we only overwrite fields explicitly sent
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );
    const touchesContent = CONTENT_FIELDS.some((key) => key in filtered);
    // Only clear publish state for posts that have not gone out yet. Blanking
    // `externalId` on a live post detaches it from the metrics poller, which is
    // silent and unrecoverable: the post stops collecting metrics, drops out of
    // analytics and the leaderboard, and loses its "view on platform" link,
    // while nothing on the platform actually changed.
    const clearsPublishResults = touchesContent && isResettablePublishState(existing.status);
    // Editing an already-published post is allowed (users legitimately fix a
    // draft-of-record after the fact), but the stored content no longer matches
    // what is live, so record when they diverged and let the UI say so.
    const marksContentDiverged =
      touchesContent && !clearsPublishResults && existing.status === 'published';
    const patch = {
      ...filtered,
      ...(marksContentDiverged ? { contentDivergedAt: new Date().toISOString() } : {}),
      ...(clearsPublishResults
        ? {
            publishResults: [],
            publishedChannels: [],
            retryFailedChannelsOnly: null,
            externalId: '',
            externalUrl: '',
            errorMessage: '',
            tiktokPublishId: '',
            tiktokLastStatus: '',
            tiktokStatusUpdatedAt: null,
            nextAction: null,
            actionRequiredAt: null,
          }
        : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };
    await ref.update(patch);
    if ('mediaUrls' in filtered) {
      // Keep reference counts in step with the edit, so media dropped from a
      // post becomes collectable and media added to one stops being.
      await syncPostMediaReferences(
        ctx.workspaceId,
        Array.isArray(existing.mediaUrls) ? (existing.mediaUrls as string[]) : [],
        Array.isArray(filtered.mediaUrls) ? (filtered.mediaUrls as string[]) : [],
      ).catch(() => undefined);
    }
    if (nextPost.status === 'scheduled') {
      await markWorkspaceDue(
        ctx.workspaceId,
        typeof nextPost.scheduledAt === 'string' ? nextPost.scheduledAt : Date.now(),
        'scheduled_post',
      ).catch((error) => {
        logger.warn('updated scheduled post due marker failed; compatibility sweep will recover it', {
          event: 'worker.mark_due_failed',
          workspaceId: ctx.workspaceId,
          postId: id,
          err: error,
        });
      });
    }
    return apiOk({ id, ...snap.data(), ...patch });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const existing = snap.data() as Record<string, unknown>;
    assertPostMutable(existing, 'delete');

    await ref.delete();

    // Drop this post's claim on its media. Reference counted rather than
    // cascade deleted: an asset can be attached to several posts, so deleting
    // one post must not delete media another post still uses. Assets that
    // reach zero references are marked orphaned and collected later.
    await releasePostMedia(ctx.workspaceId, existing.mediaUrls);

    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
