import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiCreated } from '@/lib/api-response';
import { generateContent } from '@/lib/ai/content-generator';
import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';

const generatePostSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID is required'),
  channel: z.enum(socialChannels),
  contentType: z.enum(['social_post', 'ad_copy', 'full_campaign']).default('social_post'),
  additionalContext: z.string().trim().max(2000).default(''),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = generatePostSchema.parse(body);

    // Load product
    const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');

    const product = productSnap.data()!;

    // Generate content with brand voice and product context
    const result = await generateContent({
      type: data.contentType,
      productName: product.name,
      productDescription: product.description || product.tagline || '',
      productCategories: product.categories || (product.category ? [product.category] : undefined),
      targetAudience: product.brandVoice?.targetAudience || '',
      channel: data.channel,
      tone: product.brandVoice?.tone || 'Professional',
      additionalContext: data.additionalContext,
      brandVoice: product.brandVoice || undefined,
    });

    // Save as draft post
    const now = new Date().toISOString();
    const postPayload = {
      content: result.content,
      channel: data.channel,
      status: 'draft',
      scheduledAt: null,
      mediaUrls: [],
      productId: data.productId,
      generatedBy: 'openai',
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const postRef = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .add(postPayload);

    return apiCreated({ id: postRef.id, ...postPayload });
  } catch (error) {
    return apiError(error);
  }
}
