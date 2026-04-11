import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { updateSlideshowSchema } from '@/lib/schemas';
import { slideshowDoc, slideshowSlidesCollection } from '@/lib/slideshows/firestore';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const [slideshowSnap, slidesSnap] = await Promise.all([
      slideshowDoc(ctx.workspaceId, id).get(),
      slideshowSlidesCollection(ctx.workspaceId, id).orderBy('index', 'asc').get(),
    ]);

    if (!slideshowSnap.exists) throw new Error('NOT_FOUND');

    const slides = slidesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return apiOk({ id, ...slideshowSnap.data(), slides });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');
    const { id } = await params;

    const body = await req.json();
    const data = updateSlideshowSchema.parse(body);

    const ref = slideshowDoc(ctx.workspaceId, id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    // Slides update is handled separately as subcollection writes
    const { slides: slidesUpdate, ...slideshowFields } = data;

    const filtered = Object.fromEntries(
      Object.entries(slideshowFields).filter(([, v]) => v !== undefined),
    );

    const patch = {
      ...filtered,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    const writes: Promise<unknown>[] = [ref.update(patch)];

    if (slidesUpdate && slidesUpdate.length > 0) {
      const slidesCol = slideshowSlidesCollection(ctx.workspaceId, id);
      const now = new Date().toISOString();
      const batch = adminDb.batch();
      for (const slide of slidesUpdate) {
        if (!slide.id) continue;
        const slideRef = slidesCol.doc(slide.id);
        const { id: _id, ...slideFields } = slide;
        batch.set(slideRef, { ...slideFields, updatedAt: now }, { merge: true });
      }
      writes.push(batch.commit());
    }

    await Promise.all(writes);

    return apiOk({ id, ...snap.data(), ...patch });
  } catch (error) {
    return apiError(error);
  }
}
