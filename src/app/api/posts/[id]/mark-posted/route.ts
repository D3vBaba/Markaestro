import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getPostTargetChannels } from '@/lib/social/publisher';
import {
  isPlatformActionRequiredStatus,
  MANUAL_PUBLISHED_VIA,
  parseManualPostUrl,
} from '@/lib/manual-publish-flow';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const markPostedSchema = z.object({
  // Optional link to the live post; used for attribution when parseable.
  externalUrl: z.string().trim().url().max(2000).optional(),
});

/**
 * POST /api/posts/:id/mark-posted — the user confirms they published a
 * queued post natively themselves. Closes the manual publishing loop:
 * platform_action_required → published, with no platform API involved.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');

    const { id } = await params;
    const body = markPostedSchema.parse(await req.json().catch(() => ({})));

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const nowIso = new Date().toISOString();

    const outcome = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { ok: false as const, status: 404, error: 'Post not found' };
      }

      const post = snap.data() as Record<string, unknown>;
      if (!isPlatformActionRequiredStatus(post.status)) {
        return {
          ok: false as const,
          status: 400,
          error: `Only posts waiting to be posted can be marked as posted (status is "${post.status}")`,
        };
      }

      const targetChannels = getPostTargetChannels(post);
      const primaryChannel = typeof post.channel === 'string' ? post.channel : targetChannels[0] || '';
      const { externalUrl, externalId } = parseManualPostUrl(primaryChannel, body.externalUrl ?? '');

      const publishResults = targetChannels.map((channel) => ({
        channel,
        success: true,
        ...(externalId && { externalId }),
        ...(externalUrl && { externalUrl }),
      }));

      tx.update(ref, {
        status: 'published',
        publishedVia: MANUAL_PUBLISHED_VIA,
        publishedAt: nowIso,
        publishedBy: ctx.uid,
        externalId,
        externalUrl,
        publishResults,
        publishedChannels: targetChannels,
        nextAction: '',
        errorMessage: '',
        publishFinishedAt: nowIso,
        publishLeaseExpiresAt: null,
        updatedAt: nowIso,
      });

      return { ok: true as const, post, externalId, externalUrl };
    });

    if (!outcome.ok) {
      return apiOk({ ok: false, error: outcome.error }, outcome.status);
    }

    if (outcome.post.createdByType === 'api_client') {
      await enqueueWebhookEvent(ctx.workspaceId, 'post.published', {
        postId: id,
        channel: outcome.post.channel,
        status: 'published',
        publishedVia: MANUAL_PUBLISHED_VIA,
        externalId: outcome.externalId,
        externalUrl: outcome.externalUrl,
      });
    }

    logger.info('post marked as manually posted', {
      event: 'posts.mark_posted',
      workspaceId: ctx.workspaceId,
      postId: id,
      hasExternalUrl: Boolean(outcome.externalUrl),
    });

    return apiOk({
      ok: true,
      id,
      status: 'published',
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
    });
  } catch (error) {
    return apiError(error);
  }
}
