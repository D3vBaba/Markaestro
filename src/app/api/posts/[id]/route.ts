import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { updatePostSchema } from '@/lib/schemas';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
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
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const body = await req.json();
    const data = updatePostSchema.parse(body);

    // Moving a post into "scheduled" queues an outbound publish, so it requires
    // a verified email. Editing drafts/content stays open to unverified users.
    if (data.status === 'scheduled' && !ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to publish.' },
        403,
      );
    }

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    // Strip undefined keys so we only overwrite fields explicitly sent
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );
    const patch = {
      ...filtered,
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
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    await ref.delete();

    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
