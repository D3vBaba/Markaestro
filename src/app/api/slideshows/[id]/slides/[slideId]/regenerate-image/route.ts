import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { generateAndUploadImage, type SlideContext } from '@/lib/ai/image-generator';
import { buildVisualSignature, buildSlideQuality } from '@/lib/slideshows/quality';
import { slideshowDoc, slideshowSlidesCollection } from '@/lib/slideshows/firestore';
import type { SlideshowSlide } from '@/lib/schemas';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');
    requirePermission(ctx, 'ai.use');

    const { id, slideId } = await params;

    // Load slideshow, the target slide, and all other slides for context
    const [ssSnap, targetSlideSnap, allSlidesSnap] = await Promise.all([
      slideshowDoc(ctx.workspaceId, id).get(),
      slideshowSlidesCollection(ctx.workspaceId, id).doc(slideId).get(),
      slideshowSlidesCollection(ctx.workspaceId, id).orderBy('index', 'asc').get(),
    ]);

    if (!ssSnap.exists) throw new Error('NOT_FOUND');
    if (!targetSlideSnap.exists) throw new Error('NOT_FOUND');

    const slideshow = ssSnap.data()!;
    const targetSlide = { id: targetSlideSnap.id, ...targetSlideSnap.data() } as SlideshowSlide & { id: string };
    const allSlides = allSlidesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Array<SlideshowSlide & { id: string }>;
    const totalSlides = allSlides.length;

    // Load product for brand context
    const productSnap = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${slideshow.productId}`)
      .get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const product = productSnap.data()!;

    // Build visual signatures for all slides that come BEFORE the target slide
    // in the sequence. These are passed to the image generator to enforce diversity.
    const previousSlides = allSlides.filter((s) => s.index < targetSlide.index);
    const previousSignatures = previousSlides.map((s) =>
      buildVisualSignature({
        headline: s.headline,
        body: s.body,
        visualIntent: s.visualIntent,
        imagePrompt: s.imagePrompt,
      }),
    );

    const slideCtx: SlideContext = {
      index: targetSlide.index,
      totalSlides,
      kind: targetSlide.kind,
      safeTextRegion: targetSlide.visualIntent.safeTextRegion,
      visualIntent: targetSlide.visualIntent,
      previousVisualSignatures: previousSignatures,
    };

    // Mark the slide as pending before kicking off generation
    const slideRef = slideshowSlidesCollection(ctx.workspaceId, id).doc(slideId);
    await slideRef.update({ imageStatus: 'pending', updatedAt: new Date().toISOString() });

    let imageUrl: string;
    try {
      const result = await generateAndUploadImage(
        {
          prompt: targetSlide.imagePrompt,
          style: slideshow.imageStyle || 'branded',
          aspectRatio: '9:16',
          provider: slideshow.imageProvider || 'gemini',
          productName: product.name,
          productDescription: product.description || '',
          productCategories: product.categories || [],
          productUrl: product.url || undefined,
          brandIdentity: product.brandIdentity || undefined,
          brandVoice: product.brandVoice || undefined,
          generationMode: 'slideshow_slide',
          slideContext: slideCtx,
        },
        ctx.workspaceId,
      );
      imageUrl = result.imageUrl;
    } catch (err) {
      await slideRef.update({ imageStatus: 'failed', updatedAt: new Date().toISOString() });
      throw err;
    }

    // Recompute quality scores — distinctiveness is relative to all other slides
    // (not just previous ones) so we pass the full set minus the current slide.
    const otherSlides = allSlides.filter((s) => s.index !== targetSlide.index);
    const updatedQuality = buildSlideQuality(
      {
        headline: targetSlide.headline,
        body: targetSlide.body,
        kind: targetSlide.kind,
        visualIntent: targetSlide.visualIntent,
        imagePrompt: targetSlide.imagePrompt,
      },
      otherSlides.map((s) => ({
        headline: s.headline,
        body: s.body,
        visualIntent: s.visualIntent,
        imagePrompt: s.imagePrompt,
      })),
    );

    const now = new Date().toISOString();
    await slideRef.update({
      imageUrl,
      imageStatus: 'generated',
      quality: updatedQuality,
      updatedAt: now,
    });

    return apiOk({
      slideId,
      slideshowId: id,
      imageUrl,
      imageStatus: 'generated',
      quality: updatedQuality,
    });
  } catch (error) {
    return apiError(error);
  }
}
