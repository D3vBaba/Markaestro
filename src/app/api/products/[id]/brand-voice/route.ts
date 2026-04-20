import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { brandVoiceSchema, brandIdentitySchema } from '@/lib/schemas';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const data = snap.data();
    return apiOk({
      id,
      brandVoice: data?.brandVoice || null,
      brandIdentity: data?.brandIdentity || null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    const { id } = await params;
    const body = await req.json();

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const update: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    // Parse brand voice fields (existing behavior)
    if (body.tone !== undefined || body.style !== undefined || body.keywords !== undefined) {
      update.brandVoice = brandVoiceSchema.parse(body);
    }

    // Parse brand identity if provided
    if (body.brandIdentity !== undefined) {
      update.brandIdentity = brandIdentitySchema.parse(body.brandIdentity);
    }

    await ref.update(update);

    const updatedSnap = await ref.get();
    const updatedData = updatedSnap.data();

    return apiOk({
      id,
      brandVoice: updatedData?.brandVoice || null,
      brandIdentity: updatedData?.brandIdentity || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
