import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateImageSchema } from '@/lib/schemas';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const input = generateImageSchema.parse(body);

    // Load product data if productId provided
    let brandIdentity: ImageGenRequest['brandIdentity'];
    let brandVoice: ImageGenRequest['brandVoice'];
    let productName: string | undefined;
    let logoUrl: string | undefined;

    if (input.productId) {
      const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`);
      const productSnap = await productRef.get();
      if (productSnap.exists) {
        const product = productSnap.data()!;
        productName = product.name;
        brandIdentity = product.brandIdentity;
        brandVoice = product.brandVoice;

        // Use the product logo if user wants it included
        if (input.includeLogo && product.brandIdentity?.logoUrl) {
          logoUrl = product.brandIdentity.logoUrl;
        }
      }
    }

    const result = await generateAndUploadImage(
      {
        prompt: input.prompt,
        brandIdentity,
        brandVoice,
        productName,
        style: input.style,
        aspectRatio: input.aspectRatio,
        provider: input.provider,
        screenUrls: input.screenUrls,
        logoUrl,
      },
      ctx.workspaceId,
    );

    return apiOk({
      imageUrl: result.imageUrl,
      provider: result.provider,
      revisedPrompt: result.revisedPrompt,
    });
  } catch (error) {
    return apiError(error);
  }
}
