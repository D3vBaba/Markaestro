/**
 * Onboarding preview: scans a URL (or uses manual data), creates a product,
 * and generates a sample post — all in one request so the client has a single
 * round-trip before hitting the paywall.
 */
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { generateContent } from '@/lib/ai/content-generator';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { z } from 'zod';

const schema = z.object({
  productName: z.string().min(1).max(100),
  productDescription: z.string().min(1).max(500),
  productUrl: z.string().optional().default(''),
  tone: z.string().default('Professional, engaging'),
  targetAudience: z.string().default(''),
  channel: z.enum(['instagram', 'facebook', 'linkedin', 'twitter', 'tiktok']).default('instagram'),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  category: z.string().optional().default('saas'),
  pricingTier: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    requirePermission(ctx, 'ai.use');
    const uid = ctx.uid;
    const wsId = ctx.workspaceId;

    const body = await req.json();
    const data = schema.parse(body);

    // Create product in Firestore with all scanned fields
    const now = new Date().toISOString();
    const productPayload = {
      name: data.productName,
      description: data.productDescription,
      url: data.productUrl || '',
      category: data.category || 'saas',
      pricingTier: data.pricingTier || '',
      tags: data.tags || [],
      brandVoice: {
        tone: data.tone,
        targetAudience: data.targetAudience,
        voice: data.tone,
        keywords: [],
        avoidWords: [],
        cta: '',
        sampleVoice: '',
        style: '',
      },
      brandIdentity: {
        logoUrl: data.logoUrl || '',
        primaryColor: data.primaryColor || '#6366f1',
        secondaryColor: data.secondaryColor || '',
        accentColor: data.accentColor || '',
      },
      workspaceId: wsId,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      onboardingProduct: true,
    };

    const productRef = await adminDb
      .collection(`workspaces/${wsId}/products`)
      .add(productPayload);

    // Generate a sample post
    let postContent = '';
    try {
      const result = await generateContent({
        type: 'social_post',
        productName: data.productName,
        productDescription: data.productDescription,
        targetAudience: data.targetAudience,
        channel: data.channel,
        tone: data.tone,
        additionalContext: 'This is a compelling introductory post that showcases the product value. Make it engaging and include relevant emojis.',
      });
      postContent = result.content;
    } catch {
      postContent = `✨ Introducing ${data.productName}\n\n${data.productDescription}\n\nReady to transform how you work? Try it today.\n\n#marketing #growth #${data.productName.toLowerCase().replace(/\s+/g, '')}`;
    }

    return apiOk({
      productId: productRef.id,
      productName: data.productName,
      postContent,
      channel: data.channel,
      logoUrl: data.logoUrl || '',
      primaryColor: data.primaryColor || '#6366f1',
    });
  } catch (err) {
    return apiError(err);
  }
}
