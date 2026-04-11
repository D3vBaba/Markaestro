import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { generateSlideshowContent, type GenerateSlideshowInput } from '@/lib/slideshows/generator';
import { generateAndUploadImage, type SlideContext } from '@/lib/ai/image-generator';
import { buildVisualSignature } from '@/lib/slideshows/quality';
import { slideshowDoc, slideshowSlidesCollection, serializeSlideDoc } from '@/lib/slideshows/firestore';
import type { SlideshowSlide } from '@/lib/schemas';

// Max simultaneous image generation calls per slideshow — keeps provider costs
// predictable and avoids hitting per-user concurrency limits.
const IMAGE_CONCURRENCY = 2;

// ── Image generation worker pool ──────────────────────────────────────
//
// Same drain-queue pattern as the pipeline generator. Each worker pops from
// the shared queue so we naturally maintain the concurrency cap even as
// some slides finish faster than others.

type ImageTask = {
  slide: SlideshowSlide;
  slideDocId: string;
  previousSignatures: string[];
};

async function generateImagesWithConcurrency(
  tasks: ImageTask[],
  sharedReq: Omit<Parameters<typeof generateAndUploadImage>[0], 'prompt' | 'generationMode' | 'slideContext'>,
  workspaceId: string,
  slideshowId: string,
  totalSlides: number,
  onSuccess: (slideDocId: string, imageUrl: string) => void,
): Promise<void> {
  const queue = [...tasks];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const task = queue.shift()!;
      const { slide, slideDocId, previousSignatures } = task;

      const slideCtx: SlideContext = {
        index: slide.index,
        totalSlides,
        kind: slide.kind,
        safeTextRegion: slide.visualIntent.safeTextRegion,
        visualIntent: slide.visualIntent,
        previousVisualSignatures: previousSignatures,
      };

      try {
        const result = await generateAndUploadImage(
          {
            ...sharedReq,
            prompt: slide.imagePrompt,
            generationMode: 'slideshow_slide',
            slideContext: slideCtx,
          },
          workspaceId,
        );

        // Write image URL to the slide doc immediately so partial progress is
        // visible — we don't wait for the whole batch to finish.
        await slideshowSlidesCollection(workspaceId, slideshowId)
          .doc(slideDocId)
          .update({
            imageUrl: result.imageUrl,
            imageStatus: 'generated',
            updatedAt: new Date().toISOString(),
          });

        onSuccess(slideDocId, result.imageUrl);
      } catch (err) {
        console.error(
          `[slideshow:generate] Image failed for slide ${slide.index} (${slideDocId}):`,
          err instanceof Error ? err.message : err,
        );
        // Mark this slide's image as failed; the slideshow still becomes ready
        // so the user can regenerate individual slides.
        await slideshowSlidesCollection(workspaceId, slideshowId)
          .doc(slideDocId)
          .update({ imageStatus: 'failed', updatedAt: new Date().toISOString() })
          .catch(() => undefined); // ignore secondary failure
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(IMAGE_CONCURRENCY, tasks.length) },
    () => processNext(),
  );
  await Promise.all(workers);
}

// ── Route handler ─────────────────────────────────────────────────────

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let slideshowIdForFailure: string | null = null;
  let workspaceIdForFailure: string | null = null;

  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');
    requirePermission(ctx, 'ai.use');

    const { id } = await params;
    slideshowIdForFailure = id;
    workspaceIdForFailure = ctx.workspaceId;

    // ── Load slideshow ──────────────────────────────────────────────
    const ssRef = slideshowDoc(ctx.workspaceId, id);
    const ssSnap = await ssRef.get();
    if (!ssSnap.exists) throw new Error('NOT_FOUND');

    const slideshow = ssSnap.data()!;

    // Guard: reject concurrent generation attempts
    const runningStatuses = ['researching', 'generating_slides', 'generating_images'];
    if (runningStatuses.includes(slideshow.status)) {
      throw new Error('VALIDATION_SLIDESHOW_GENERATION_ALREADY_RUNNING');
    }

    // ── Load product ────────────────────────────────────────────────
    const productSnap = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${slideshow.productId}`)
      .get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const product = productSnap.data()!;

    // ── Phase 1: researching ────────────────────────────────────────
    const phase1At = new Date().toISOString();
    await ssRef.update({ status: 'researching', errorMessage: null, updatedAt: phase1At });

    const generatorInput: GenerateSlideshowInput = {
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      productUrl: product.url || undefined,
      prompt: slideshow.prompt,
      visualStyle: slideshow.visualStyle,
      brandVoice: product.brandVoice || undefined,
    };

    // ── Phase 2: generating_slides ──────────────────────────────────
    const phase2At = new Date().toISOString();
    await ssRef.update({ status: 'generating_slides', updatedAt: phase2At });

    const content = await generateSlideshowContent(generatorInput, slideshow.slideCount || 6);

    // Persist slides and updated slideshow metadata in a single batch
    const batch = adminDb.batch();

    // Overwrite title and caption from the generator if the user didn't set them
    batch.update(ssRef, {
      title: slideshow.title || content.title,
      caption: slideshow.caption || content.caption,
      slideCount: content.slides.length,
      generationVersion: (slideshow.generationVersion || 1) + 1,
      updatedAt: new Date().toISOString(),
    });

    // Delete existing slides before rewriting — clean regeneration
    const existingSlides = await slideshowSlidesCollection(ctx.workspaceId, id).get();
    for (const doc of existingSlides.docs) {
      batch.delete(doc.ref);
    }

    // Write new slides
    const slidesCol = slideshowSlidesCollection(ctx.workspaceId, id);
    const slideDocIds: string[] = [];
    for (const slide of content.slides) {
      const slideRef = slidesCol.doc();
      slideDocIds.push(slideRef.id);
      const slideDoc = serializeSlideDoc(slideRef.id, slide);
      batch.set(slideRef, slideDoc);
    }

    await batch.commit();

    // Pre-compute visual signatures for each slide so the image generator can
    // enforce diversity across the sequence without a Firestore round-trip.
    const signatures = content.slides.map((s) =>
      buildVisualSignature({
        headline: s.headline,
        body: s.body,
        visualIntent: s.visualIntent,
        imagePrompt: s.imagePrompt,
      }),
    );

    // ── Phase 3: generating_images ──────────────────────────────────
    const phase3At = new Date().toISOString();
    await ssRef.update({ status: 'generating_images', updatedAt: phase3At });

    const sharedImageReq = {
      style: slideshow.imageStyle || 'branded',
      aspectRatio: '9:16' as const,
      provider: slideshow.imageProvider || 'gemini',
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      productUrl: product.url || undefined,
      brandIdentity: product.brandIdentity || undefined,
      brandVoice: product.brandVoice || undefined,
    };

    const imageTasks: ImageTask[] = content.slides.map((slide, i) => ({
      slide,
      slideDocId: slideDocIds[i],
      // Each slide sees the signatures of all previous slides as context
      previousSignatures: signatures.slice(0, i),
    }));

    // Track which slides got images (for the summary response)
    let imagesGenerated = 0;
    await generateImagesWithConcurrency(
      imageTasks,
      sharedImageReq,
      ctx.workspaceId,
      id,
      content.slides.length,
      () => { imagesGenerated++; },
    );

    // ── Phase 4: ready ──────────────────────────────────────────────
    const readyAt = new Date().toISOString();
    await ssRef.update({ status: 'ready', updatedAt: readyAt });

    return apiOk({
      slideshowId: id,
      status: 'ready',
      slideCount: content.slides.length,
      imagesGenerated,
      title: slideshow.title || content.title,
      caption: slideshow.caption || content.caption,
    });
  } catch (error) {
    // Best-effort failure mark — do not let cleanup errors shadow the original
    if (workspaceIdForFailure && slideshowIdForFailure) {
      try {
        await slideshowDoc(workspaceIdForFailure, slideshowIdForFailure).update({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // ignore
      }
    }
    return apiError(error);
  }
}
