import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateImageSchema } from '@/lib/schemas';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';
import { researchForPipeline, buildImageResearchContext } from '@/lib/ai/pipeline-researcher';
import { checkAndIncrementUsage } from '@/lib/usage';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations');
    if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');

    const body = await req.json();
    const input = generateImageSchema.parse(body);

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

    const result = await generateAndUploadImage(
      {
        prompt: input.prompt,
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
      },
      ctx.workspaceId,
    );

    return apiOk({
      imageUrl: result.imageUrl,
      provider: result.provider,
      revisedPrompt: result.revisedPrompt,
    });
  } catch (error) {
    console.error('[generate-image] Error:', error instanceof Error ? error.message : error);
    return apiError(error);
  }
}
