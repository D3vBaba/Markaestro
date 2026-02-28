import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { updateContactSchema } from '@/lib/schemas';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'contacts')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    return apiOk({ id, ...snap.data() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const body = await req.json();
    const data = updateContactSchema.parse(body);

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'contacts')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    // If changing email, check for duplicates
    if (data.email && data.email !== snap.data()?.email) {
      const existing = await adminDb
        .collection(workspaceCollection(ctx.workspaceId, 'contacts'))
        .where('email', '==', data.email)
        .limit(1)
        .get();
      if (!existing.empty) {
        throw new Error('VALIDATION_EMAIL_ALREADY_EXISTS');
      }
    }

    const patch = {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };
    await ref.update(patch);
    return apiOk({ id, ...snap.data(), ...patch });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'contacts')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    await ref.delete();
    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
