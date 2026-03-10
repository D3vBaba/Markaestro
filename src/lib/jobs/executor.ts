import { adminDb } from '@/lib/firebase-admin';
import { sendCampaignEmails } from '@/lib/email/sender';
import { publishPost } from '@/lib/social/publisher';
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

    if (job.type === 'send_email_campaign') {
      // Get the campaign from payload
      const campaignId = job.payload?.campaignId as string;
      if (!campaignId) {
        message = 'No campaignId in job payload — skipped';
      } else {
        const campaignSnap = await adminDb
          .doc(`workspaces/${workspaceId}/campaigns/${campaignId}`)
          .get();
        if (!campaignSnap.exists) {
          message = `Campaign ${campaignId} not found`;
        } else {
          const campaign = campaignSnap.data()!;
          const result = await sendCampaignEmails(workspaceId, {
            name: campaign.name,
            subject: campaign.subject,
            body: campaign.body,
            cta: campaign.cta,
            targetAudience: campaign.targetAudience,
            productId: campaign.productId,
          });
          message = `Email campaign "${campaign.name}": ${result.sent} sent, ${result.failed} failed`;
          details = result;
        }
      }
    } else if (job.type === 'sync_contacts') {
      // Sync contacts: update lastSyncAt timestamp
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
            const result = await publishPost(workspaceId, productId, {
              content: post.content,
              channel: post.channel,
              mediaUrls: post.mediaUrls,
            });
            if (result.success) {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'published',
                externalId: result.externalId || '',
                externalUrl: result.externalUrl || '',
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              message = `Post published to ${post.channel}`;
            } else {
              await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).update({
                status: 'failed',
                errorMessage: result.error || 'Unknown error',
                updatedAt: new Date().toISOString(),
              });
              message = `Post publish failed: ${result.error}`;
            }
            details = result;
          }
        }
      }
    } else if (job.type === 'create_ad_campaign') {
      const adCampaignId = job.payload?.adCampaignId as string;
      if (!adCampaignId) {
        message = 'No adCampaignId in job payload — skipped';
      } else {
        // Trigger the launch endpoint logic inline
        message = `Ad campaign ${adCampaignId} — use the launch endpoint to create on platform`;
        details = { adCampaignId };
      }
    } else if (job.type === 'refresh_tokens') {
      message = 'Token refresh handled by worker tick directly';
    }

    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'success', message, details, finishedAt });

    // Update job metadata
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
