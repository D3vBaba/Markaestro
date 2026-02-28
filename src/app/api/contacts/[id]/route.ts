import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { asArrayOfStrings, asString } from '@/lib/validators';

function err(error: any) {
  const msg = error?.message || 'Internal error';
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === 'FORBIDDEN_WORKSPACE') return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.startsWith('VALIDATION_')) return NextResponse.json({ error: msg }, { status: 400 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const body = await req.json();
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'contacts')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const patch = {
      name: asString(body.name, snap.data()?.name || ''),
      email: asString(body.email, snap.data()?.email || ''),
      status: asString(body.status, snap.data()?.status || 'active'),
      tags: asArrayOfStrings(body.tags ?? snap.data()?.tags ?? []),
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };
    await ref.update(patch);
    return NextResponse.json({ id, ...snap.data(), ...patch });
  } catch (e: any) {
    return err(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'contacts')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await ref.delete();
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return err(e);
  }
}
