import { adminDb } from '@/lib/firebase-admin';
import { getPostTargetChannels, publishStoredPost } from '@/lib/social/publisher';
import { PLATFORM_ACTION_REQUIRED_STATUS } from '@/lib/tiktok-draft-flow';
import { logger } from '@/lib/logger';
import { JobDoc } from './types';

export function shouldDisableRecurringPublishJob(job: Pick<JobDoc, 'type' | 'schedule'>): boolean {
  return job.type === 'publish_post' && job.schedule !== 'manual';
}

export function getPublishJobSkipReason(post: Record<string, unknown>): string | null {
  const status = typeof post.status === 'string' ? post.status : '';
  if (status === 'publishing') return 'post is already publishing';
  if (status === 'published') return 'post is already published';
  if (status === PLATFORM_ACTION_REQUIRED_STATUS) return 'post is already waiting for platform action';
  return null;
}

export async function executeJob(workspaceId: string, jobId: string, job: JobDoc) {
  const startedAt = new Date().toISOString();
  const runRef = await adminDb.collection(`workspaces/${workspaceId}/job_runs`).add({
    workspaceId,
    jobId,
    status: 'started',
    message: 'Job execution started',
    startedAt,
  });

  try {
    let message = 'No-op';
    let details: Record<string, unknown> = {};

    if (shouldDisableRecurringPublishJob(job)) {
      message = 'Recurring publish_post jobs are disabled. Use scheduled posts or explicit publish runs instead.';
      details = {
        disabled: true,
        reason: 'publish_post jobs must not run on a recurring schedule',
      };
      logger.warn('recurring publish_post job disabled', {
        event: 'jobs.publish_post.recurring_disabled',
        workspaceId,
        jobId,
        schedule: job.schedule,
      });
    } else if (job.type === 'sync_contacts') {
      const contactsSnap = await adminDb
        .collection(`workspaces/${workspaceId}/contacts`)
        .get();
      message = `Contacts sync completed: ${contactsSnap.size} contacts in workspace`;
      details = { contactCount: contactsSnap.size };
    } else if (job.type === 'publish_post') {
      const postId = job.payload?.postId as string;
      if (!postId) {
        message = 'No postId in job payload — skipped';
      } else {
        const postSnap = await adminDb
          .doc(`workspaces/${workspaceId}/posts/${postId}`)
          .get();
        if (!postSnap.exists) {
          message = `Post ${postId} not found`;
        } else {
          const post = postSnap.data() as Record<string, unknown>;
          const productId = typeof post.productId === 'string' ? post.productId : undefined;
          const targetChannels = getPostTargetChannels(post);
          const skipReason = getPublishJobSkipReason(post);
          if (skipReason) {
            message = `Post ${postId} skipped: ${skipReason}`;
            details = { skipped: true, reason: skipReason, status: post.status };
            logger.info('publish_post job skipped existing publish state', {
              event: 'jobs.publish_post.skipped_existing_state',
              workspaceId,
              jobId,
              postId,
              status: post.status,
              reason: skipReason,
            });
          } else if (!productId && targetChannels.some((channel) => channel !== 'tiktok')) {
            message = `Post ${postId} has no associated product — skipped`;
          } else {
            const result = await publishStoredPost(workspaceId, productId, post);
            const successfulChannels = result.channels.filter((c) => c.success);
            if (result.pending) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'publishing',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishResults: result.channels,
                updatedAt: new Date().toISOString(),
              });
              message = `Post is still processing on ${targetChannels.join(' & ')}`;
            } else if (result.success) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'published',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishResults: result.channels,
                publishedChannels: successfulChannels.map((c) => c.channel),
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              message = `Post published to ${successfulChannels.map((c) => c.channel).join(' & ')}`;
            } else {
              const partialFailure = result.partialFailure || result.channels.some((c) => c.success) && result.channels.some((c) => !c.success && !c.pending);
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: partialFailure ? 'partial_failed' : 'failed',
                errorMessage: result.error || 'Unknown error',
                publishResults: result.channels,
                publishedChannels: successfulChannels.map((c) => c.channel),
                retryFailedChannelsOnly: partialFailure ? true : null,
                updatedAt: new Date().toISOString(),
              });
              message = `Post publish failed: ${result.error}`;
            }
            details = result;
          }
        }
      }
    } else if (job.type === 'refresh_tokens') {
      message = 'Token refresh handled by worker tick directly';
    }

    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'success', message, details, finishedAt });

    const next = computeNextRun(job.schedule, job.hourUTC, job.minuteUTC);
    await adminDb.doc(`workspaces/${workspaceId}/jobs/${jobId}`).update({
      lastRunAt: finishedAt,
      nextRunAt: shouldDisableRecurringPublishJob(job) ? null : next,
      ...(shouldDisableRecurringPublishJob(job)
        ? {
            enabled: false,
            disabledAt: finishedAt,
            disabledReason: 'Recurring publish_post jobs are disabled by the publisher safety guard.',
          }
        : {}),
      updatedAt: finishedAt,
    });

    return { ok: true, message, details, runId: runRef.id };
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'failed', message: errorMsg, finishedAt });
    return { ok: false, error: errorMsg, runId: runRef.id };
  }
}

export function computeNextRun(schedule: 'manual' | 'daily', hourUTC = 15, minuteUTC = 0) {
  if (schedule === 'manual') return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
