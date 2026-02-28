import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';

function err(error: any) {
  const msg = error?.message || 'Internal error';
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === 'FORBIDDEN_WORKSPACE') return NextResponse.json({ error: msg }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/job_runs`)
      .where('jobId', '==', id)
      .orderBy('startedAt', 'desc')
      .limit(20)
      .get();
    const runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ runs });
  } catch (e: any) {
    return err(e);
  }
}
