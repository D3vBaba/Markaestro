import { adminDb } from '@/lib/firebase-admin';
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
    // Placeholder handlers - can be replaced with real integrations.
    let message = 'No-op';
    if (job.type === 'send_email_campaign') {
      message = `Queued email campaign: ${job.payload?.campaignName || 'Unnamed Campaign'}`;
    } else if (job.type === 'sync_contacts') {
      message = 'Contacts sync completed';
    } else if (job.type === 'generate_content') {
      message = 'Content generation completed';
    }

    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'success', message, finishedAt });

    // update job metadata
    const next = computeNextRun(job.schedule, job.hourUTC, job.minuteUTC);
    await adminDb.doc(`workspaces/${workspaceId}/jobs/${jobId}`).update({
      lastRunAt: finishedAt,
      nextRunAt: next,
      updatedAt: finishedAt,
    });

    return { ok: true, message, runId: runRef.id };
  } catch (e: any) {
    const finishedAt = new Date().toISOString();
    await runRef.update({ status: 'failed', message: e?.message || 'Unknown error', finishedAt });
    return { ok: false, error: e?.message || 'Unknown error', runId: runRef.id };
  }
}

export function computeNextRun(schedule: 'manual' | 'daily', hourUTC = 15, minuteUTC = 0) {
  if (schedule === 'manual') return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
