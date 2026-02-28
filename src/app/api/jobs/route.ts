import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { asBool, asString } from '@/lib/validators';
import { computeNextRun } from '@/lib/jobs/executor';

function err(error: any) {
  const msg = error?.message || 'Internal error';
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === 'FORBIDDEN_WORKSPACE') return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.startsWith('VALIDATION_')) return NextResponse.json({ error: msg }, { status: 400 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const snap = await adminDb.collection(`workspaces/${ctx.workspaceId}/jobs`).orderBy('createdAt', 'desc').limit(100).get();
    const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ workspaceId: ctx.workspaceId, jobs });
  } catch (e: any) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();

    const name = asString(body.name);
    if (!name) throw new Error('VALIDATION_NAME_REQUIRED');

    const type = asString(body.type || 'send_email_campaign');
    const schedule = asString(body.schedule || 'manual') as 'manual' | 'daily';
    const hourUTC = Number.isFinite(Number(body.hourUTC)) ? Number(body.hourUTC) : 15;
    const minuteUTC = Number.isFinite(Number(body.minuteUTC)) ? Number(body.minuteUTC) : 0;

    const now = new Date().toISOString();
    const payload = {
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      name,
      type,
      enabled: asBool(body.enabled, true),
      schedule,
      hourUTC,
      minuteUTC,
      payload: typeof body.payload === 'object' && body.payload ? body.payload : {},
      nextRunAt: computeNextRun(schedule, hourUTC, minuteUTC),
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb.collection(`workspaces/${ctx.workspaceId}/jobs`).add(payload);
    return NextResponse.json({ id: ref.id, ...payload }, { status: 201 });
  } catch (e: any) {
    return err(e);
  }
}
