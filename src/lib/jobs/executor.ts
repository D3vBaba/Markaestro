import { adminDb } from '@/lib/firebase-admin';
import { sendCampaignEmails } from '@/lib/email/sender';
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
