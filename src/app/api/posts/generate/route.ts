import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiCreated } from '@/lib/api-response';
import { generateContent } from '@/lib/ai/content-generator';
import { researchForPipeline } from '@/lib/ai/pipeline-researcher';
import { checkAndIncrementUsage } from '@/lib/usage';
import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';
import type { ResearchBrief } from '@/lib/schemas';

export const runtime = 'nodejs';


const generatePostSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID is required'),
  channel: z.enum(socialChannels),
  contentType: z.enum(['social_post', 'ad_copy', 'full_campaign']).default('social_post'),
  additionalContext: z.string().trim().max(2000).default(''),
});

function buildResearchContext(brief: ResearchBrief): string {
  const parts: string[] = ['--- MARKET RESEARCH (use to ground your post in real context) ---'];

  if (brief.trends.length > 0) {
    parts.push('CURRENT TRENDS & ANGLES:');
    brief.trends.slice(0, 3).forEach((t) => {
      parts.push(`- ${t.trend}: ${t.contentAngle}`);
    });
  }

  if (brief.newsHookHeadlines && brief.newsHookHeadlines.length > 0) {
    parts.push('TIMELY NEWS HOOKS:');
    brief.newsHookHeadlines.slice(0, 3).forEach((h) => parts.push(`- ${h}`));
  }

  if (brief.competitors.length > 0) {
    const gaps = brief.competitors
      .map((c) => c.weaknesses)
      .filter(Boolean)
      .slice(0, 2);
    if (gaps.length > 0) {
      parts.push('COMPETITOR GAPS TO EXPLOIT:');
      gaps.forEach((g) => parts.push(`- ${g}`));
    }
  }

  parts.push('--- END RESEARCH ---');
  return parts.join('\n');
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    requirePermission(ctx, 'ai.use');

    const quota = await checkAndIncrementUsage(ctx.uid, 'aiGenerations', ctx.workspaceId);
    if (!quota.allowed) throw new Error('QUOTA_EXCEEDED');

    const body = await req.json();
    const data = generatePostSchema.parse(body);

    // Load product
    const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');

    const product = productSnap.data()!;

    // Run market research (uses 24hr cache — only slow on first call per product per day)
    let researchContext: string | undefined;
    try {
      const brief: ResearchBrief = await researchForPipeline({
        productId: data.productId,
        productName: product.name,
        productDescription: product.description || product.tagline || '',
        productUrl: product.url || undefined,
        productCategories: product.categories || (product.category ? [product.category] : []),
        brandVoice: product.brandVoice || undefined,
      });
      researchContext = buildResearchContext(brief);
    } catch {
      // Research failure is non-fatal — generate without it
    }

    // Generate content with brand voice, product context, and market research
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
      researchContext,
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
