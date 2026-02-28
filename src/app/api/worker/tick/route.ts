import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { executeJob } from '@/lib/jobs/executor';

function unauthorized() {
  return NextResponse.json({ error: 'UNAUTHORIZED_WORKER' }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.WORKER_SECRET || '';
  const token = req.headers.get('x-worker-secret') || '';
  if (!secret || token !== secret) return unauthorized();

  const nowIso = new Date().toISOString();

  // Avoid collectionGroup index complexity in early phase.
  const wsSnap = await adminDb.collection('workspaces').limit(50).get();

  let scanned = 0;
  const dueJobs: Array<{ workspaceId: string; jobId: string; data: any }> = [];

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;
    const jobsSnap = await adminDb.collection(`workspaces/${workspaceId}/jobs`).where('enabled', '==', true).limit(100).get();
    scanned += jobsSnap.size;
    for (const j of jobsSnap.docs) {
      const d = j.data() as any;
      if (d.schedule !== 'daily') continue;
      if (d.nextRunAt && String(d.nextRunAt) > nowIso) continue;
      dueJobs.push({ workspaceId, jobId: j.id, data: d });
    }
  }

  const results: any[] = [];
  for (const j of dueJobs) {
    const r = await executeJob(j.workspaceId, j.jobId, j.data);
    results.push({ workspaceId: j.workspaceId, jobId: j.jobId, ...r });
  }

  return NextResponse.json({ ok: true, workspaces: wsSnap.size, scanned, due: dueJobs.length, processed: results.length, results });
}
