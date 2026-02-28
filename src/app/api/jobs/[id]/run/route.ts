import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { executeJob } from '@/lib/jobs/executor';

function err(error: any) {
  const msg = error?.message || 'Internal error';
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === 'FORBIDDEN_WORKSPACE') return NextResponse.json({ error: msg }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/jobs/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const job = snap.data() as any;
    if (!job.enabled) return NextResponse.json({ error: 'JOB_DISABLED' }, { status: 400 });

    const result = await executeJob(ctx.workspaceId, id, job);
    return NextResponse.json({ jobId: id, ...result });
  } catch (e: any) {
    return err(e);
  }
}
