import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiCreated } from '@/lib/api-response';
import { assertSlideshowExportable, buildExportedSlideshowPost } from '@/lib/slideshows/export';
import { slideshowDoc, slideshowSlidesCollection } from '@/lib/slideshows/firestore';
import type { SlideshowSlide } from '@/lib/schemas';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');

    const { id } = await params;

    // Load slideshow and all slides in parallel
    const [ssSnap, slidesSnap] = await Promise.all([
      slideshowDoc(ctx.workspaceId, id).get(),
      slideshowSlidesCollection(ctx.workspaceId, id).orderBy('index', 'asc').get(),
    ]);

    if (!ssSnap.exists) throw new Error('NOT_FOUND');

    const slideshow = ssSnap.data()!;
    const slides = slidesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as SlideshowSlide[];

    // Validate export preconditions (throws descriptive VALIDATION_* errors)
    assertSlideshowExportable(
      {
        channel: slideshow.channel,
        status: slideshow.status,
        caption: slideshow.caption,
        title: slideshow.title,
        coverSlideIndex: slideshow.coverSlideIndex ?? 0,
      },
      slides,
    );

    // Build the post payload using the domain helper
    const postPayload = buildExportedSlideshowPost(
      {
        id,
        productId: slideshow.productId,
        caption: slideshow.caption,
        title: slideshow.title,
        coverSlideIndex: slideshow.coverSlideIndex ?? 0,
        channel: slideshow.channel,
        status: slideshow.status,
      },
      slides,
    );

    // Write the post and update the slideshow in a single transaction so they
    // stay consistent even if one write fails.
    const postRef = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`).doc();
    const now = new Date().toISOString();

    await adminDb.runTransaction(async (tx) => {
      tx.set(postRef, {
        ...postPayload,
        workspaceId: ctx.workspaceId,
        createdBy: ctx.uid,
        createdAt: now,
        updatedAt: now,
      });

      tx.update(slideshowDoc(ctx.workspaceId, id), {
        status: 'exported',
        exportPostId: postRef.id,
        updatedAt: now,
      });
    });

    return apiCreated({
      postId: postRef.id,
      slideshowId: id,
      channel: postPayload.channel,
      mediaUrls: postPayload.mediaUrls,
      slideCount: postPayload.slideshowSlideCount,
    });
  } catch (error) {
    return apiError(error);
  }
}
