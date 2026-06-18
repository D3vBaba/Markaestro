import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { updateProductSchema } from '@/lib/schemas';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
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
    requirePermission(ctx, 'products.write');
    const { id } = await params;
    const body = await req.json();
    const data = updateProductSchema.parse(body);

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

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
    requirePermission(ctx, 'products.write');
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const postsRef = adminDb.collection(`${workspaceCollection(ctx.workspaceId, 'posts')}`);
    const activePosts = await postsRef
      .where('productId', '==', id)
      .where('status', 'in', ['scheduled', 'publishing'])
      .limit(1)
      .get();
    if (!activePosts.empty) {
      return apiOk({
        ok: false,
        error: 'Cancel or finish scheduled/publishing posts before deleting this product.',
      }, 409);
    }

    const referencingPosts = await getAllMatchingDocs(
      postsRef.where('productId', '==', id).orderBy('__name__'),
    );
    for (let i = 0; i < referencingPosts.length; i += 450) {
      const batch = adminDb.batch();
      for (const post of referencingPosts.slice(i, i + 450)) {
        batch.update(post.ref, {
          productId: '',
          deletedProductId: id,
          productDeletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await batch.commit();
    }

    await adminDb.recursiveDelete(ref);
    return apiOk({ ok: true, id, detachedPosts: referencingPosts.length });
  } catch (error) {
    return apiError(error);
  }
}
