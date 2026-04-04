import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/ai/ugc-avatars — List saved avatar face images for the workspace.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);

    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/ugcAvatars`)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const avatars = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return apiOk({ avatars });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * POST /api/ai/ugc-avatars — Save a new avatar face image.
 * Body: { name, imageUrl }
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');
    const body = await req.json();
    const { name, imageUrl } = body;

    if (!name || !imageUrl) throw new Error('VALIDATION_MISSING_FIELDS');

    const col = adminDb.collection(`workspaces/${ctx.workspaceId}/ugcAvatars`);
    const docRef = col.doc();
    const data = {
      name: String(name).slice(0, 100),
      imageUrl: String(imageUrl).slice(0, 2000),
      createdAt: new Date().toISOString(),
      createdBy: ctx.uid,
    };
    await docRef.set(data);

    return apiOk({ id: docRef.id, ...data });
  } catch (error) {
    return apiError(error);
  }
}
