import { adminDb } from '@/lib/firebase-admin';
import { publishPostMultiChannel } from '@/lib/social/publisher';
import { JobDoc } from './types';

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

    if (job.type === 'sync_contacts') {
      const contactsSnap = await adminDb
        .collection(`workspaces/${workspaceId}/contacts`)
        .get();
      message = `Contacts sync completed: ${contactsSnap.size} contacts in workspace`;
      details = { contactCount: contactsSnap.size };
    } else if (job.type === 'generate_content') {
      message = 'Content generation requires AI integration — configure Claude API key in settings';
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
          const post = postSnap.data()!;
          const productId = post.productId as string | undefined;
          if (!productId) {
            message = `Post ${postId} has no associated product — skipped`;
          } else {
            const result = await publishPostMultiChannel(workspaceId, productId, {
              content: post.content,
              channel: post.channel,
              mediaUrls: post.mediaUrls,
              deliveryMode: post.deliveryMode === 'user_review' ? 'user_review' : 'direct_publish',
              destinationProvider: typeof post.destinationProvider === 'string' && post.destinationProvider
                ? post.destinationProvider
                : undefined,
            });
            const successfulChannels = result.channels.filter((c) => c.success);
            if (result.pending) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'publishing',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishResults: result.channels,
                updatedAt: new Date().toISOString(),
              });
              message = `Post is still processing on ${post.channel}`;
            } else if (result.reviewRequired) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'exported_for_review',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishResults: result.channels,
                nextAction: result.nextAction || 'open_tiktok_inbox_and_complete_editing',
                updatedAt: new Date().toISOString(),
              });
              message = `Post exported to ${post.channel} for manual review`;
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
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'failed',
                errorMessage: result.error || 'Unknown error',
                publishResults: result.channels,
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
      nextRunAt: next,
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
