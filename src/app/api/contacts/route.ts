import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { assertRequired } from '@/lib/validators';

function errorResponse(error: any) {
  const msg = error?.message || 'Internal error';
  if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === 'FORBIDDEN_WORKSPACE') return NextResponse.json({ error: msg }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const snapshot = await adminDb.collection(workspaceCollection(ctx.workspaceId, 'contacts')).limit(100).get();
    const contacts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({ workspaceId: ctx.workspaceId, contacts });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const now = new Date().toISOString();
    assertRequired(body.name ?? '', 'name');
    assertRequired(body.email ?? '', 'email');
    const payload = {
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      name: body.name ?? '',
      email: body.email ?? '',
      status: body.status ?? 'active',
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
    };
    const ref = await adminDb.collection(workspaceCollection(ctx.workspaceId, 'contacts')).add(payload);
    return NextResponse.json({ id: ref.id, ...payload }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
}
