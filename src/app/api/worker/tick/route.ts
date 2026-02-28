import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';
import { safeCompare } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(req: Request) {
  try {
    const secret = process.env.WORKER_SECRET || '';
    const token = req.headers.get('x-worker-secret') || '';

    if (!secret || !safeCompare(token, secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    const nowIso = new Date().toISOString();

    const wsSnap = await adminDb.collection('workspaces').limit(200).get();

    let scanned = 0;
    const dueJobs: Array<{ workspaceId: string; jobId: string; data: Record<string, unknown> }> = [];

    for (const ws of wsSnap.docs) {
      const workspaceId = ws.id;
      const jobsSnap = await adminDb
        .collection(`workspaces/${workspaceId}/jobs`)
        .where('enabled', '==', true)
        .where('schedule', '==', 'daily')
        .limit(200)
        .get();

      scanned += jobsSnap.size;

      for (const j of jobsSnap.docs) {
        const d = j.data();
        if (d.nextRunAt && String(d.nextRunAt) > nowIso) continue;
        dueJobs.push({ workspaceId, jobId: j.id, data: d });
      }
    }

    const results: Record<string, unknown>[] = [];
    for (const j of dueJobs) {
      const r = await executeJob(j.workspaceId, j.jobId, j.data as any);
      results.push({ workspaceId: j.workspaceId, jobId: j.jobId, ...r });
    }

    return apiOk({
      ok: true,
      workspaces: wsSnap.size,
      scanned,
      due: dueJobs.length,
      processed: results.length,
      results,
    });
  } catch (error) {
    return apiError(error);
  }
}
