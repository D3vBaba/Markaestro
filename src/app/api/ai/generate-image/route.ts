import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateImageSchema } from '@/lib/schemas';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';
import { researchForPipeline, buildImageResearchContext } from '@/lib/ai/pipeline-researcher';
import { checkAndIncrementUsage } from '@/lib/usage';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');

    const body = await req.json();
    const input = generateImageSchema.parse(body);

    // Charge one quota unit per requested image up-front. If any increment fails,
    // we still honor quotas for the ones already counted (no refund logic yet).
    for (let i = 0; i < input.count; i++) {
      const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations', ctx.workspaceId);
      if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');
    }

    // Load full product data if productId provided
    let brandIdentity: ImageGenRequest['brandIdentity'];
    let brandVoice: ImageGenRequest['brandVoice'];
    let productName: string | undefined;
    let productDescription: string | undefined;
    let productCategories: string[] | undefined;
    let productUrl: string | undefined;
    let logoUrl: string | undefined;
    let researchContext: ImageGenRequest['researchContext'];

    if (input.productId) {
      const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`);
      const productSnap = await productRef.get();
      if (productSnap.exists) {
        const product = productSnap.data()!;
        productName = product.name;
        productDescription = product.description || product.tagline || '';
        productCategories = product.categories || (product.category ? [product.category] : undefined);
        productUrl = product.url || product.website || '';
        brandIdentity = product.brandIdentity;
        brandVoice = product.brandVoice;

        if (input.includeLogo && product.brandIdentity?.logoUrl) {
          logoUrl = product.brandIdentity.logoUrl;
        }

        // Fetch research context for visual grounding (cache hit = instant)
        try {
          const brief = await researchForPipeline({
            productId: input.productId,
            productName: product.name,
            productDescription: product.description || product.tagline || '',
            productUrl: product.url || product.website || undefined,
            productCategories: product.categories || (product.category ? [product.category] : []),
            brandVoice: product.brandVoice || undefined,
          });
          researchContext = buildImageResearchContext(brief);
        } catch {
          // Non-fatal — generate without research context
        }
      }
    }

    const genRequest = {
      prompt: input.prompt,
      promptMode: input.promptMode,
      customPrompt: input.customPrompt,
      brandIdentity,
      brandVoice,
      productName,
      productDescription,
      productCategories,
      productUrl,
      channel: input.channel,
      subtype: input.subtype,
      style: input.style,
      aspectRatio: input.aspectRatio,
      provider: input.provider,
      screenUrls: input.screenUrls,
      logoUrl,
      researchContext,
    } as const;

    // Run N generations in parallel. If some fail, return the successful ones
    // (at least one must succeed or the whole request fails).
    const settled = await Promise.allSettled(
      Array.from({ length: input.count }, () => generateAndUploadImage(genRequest, ctx.workspaceId)),
    );

    const successes = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason] : []));

    if (successes.length === 0) {
      const firstError = failures[0];
      throw firstError instanceof Error ? firstError : new Error('Image generation failed');
    }

    const imageUrls = successes.map((r) => r.imageUrl);
    return apiOk({
      imageUrl: imageUrls[0], // backwards-compat: primary image
      imageUrls,
      provider: successes[0].provider,
      revisedPrompt: successes[0].revisedPrompt,
      requested: input.count,
      generated: imageUrls.length,
      partial: imageUrls.length < input.count,
    });
  } catch (error) {
    console.error('[generate-image] Error:', error instanceof Error ? error.message : error);
    return apiError(error);
  }
}
