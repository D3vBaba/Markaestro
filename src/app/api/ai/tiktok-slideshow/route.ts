import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateTikTokSlideshowSchema } from '@/lib/schemas';
import { generateTikTokSlideshow } from '@/lib/ai/tiktok-slideshow-generator';
import { checkAndIncrementUsage } from '@/lib/usage';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');

    const body = await req.json();
    const input = generateTikTokSlideshowSchema.parse(body);

    // One quota unit per slide image up-front. The story planning LLM call is
    // negligible compared to image gen so we don't bill it separately.
    for (let i = 0; i < input.slideCount; i++) {
      const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations', ctx.workspaceId);
      if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');
    }

    const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('Product not found');

    const product = productSnap.data()!;
    const result = await generateTikTokSlideshow(
      {
        productName: product.name,
        productDescription: product.description || product.tagline || '',
        productCategories: product.categories || (product.category ? [product.category] : undefined),
        brandIdentity: product.brandIdentity,
        brandVoice: product.brandVoice,
        slideCount: input.slideCount,
        storyStyle: input.storyStyle,
        hint: input.hint,
      },
      ctx.workspaceId,
    );

    return apiOk({
      hookLine: result.hookLine,
      caption: result.caption,
      hashtags: result.hashtags,
      slides: result.slides,
      slideImageUrls: result.slideImageUrls,
      failedSlideIndices: result.failedSlideIndices,
      requested: input.slideCount,
      generated: result.slideImageUrls.filter((u) => u).length,
      partial: result.failedSlideIndices.length > 0,
    });
  } catch (error) {
    console.error('[tiktok-slideshow] Error:', error instanceof Error ? error.message : error);
    return apiError(error);
  }
}
