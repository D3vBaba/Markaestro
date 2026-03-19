import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { researchForPipeline } from '@/lib/ai/pipeline-researcher';
import { generatePipelinePosts } from '@/lib/ai/pipeline-generator';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';
import { z } from 'zod';
import { imageStyles, imageProviders } from '@/lib/schemas';
import type { PipelineConfig, ResearchBrief, SocialChannel, ImageStyle, ImageProvider } from '@/lib/schemas';

const requestSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID is required'),
  imageStyle: z.enum(imageStyles).default('branded'),
  imageProvider: z.enum(imageProviders).default('gemini'),
  skipImages: z.boolean().default(false),
});

const IMAGE_CONCURRENCY = 3;

async function generateImagesWithConcurrency(
  tasks: Array<{ imagePrompt: string; sequence: number }>,
  imageReq: Omit<ImageGenRequest, 'prompt'>,
  workspaceId: string,
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  const queue = [...tasks];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const task = queue.shift()!;
      try {
        const result = await generateAndUploadImage(
          { ...imageReq, prompt: task.imagePrompt },
          workspaceId,
        );
        results.set(task.sequence, result.imageUrl);
      } catch (err) {
        console.error(`[pipeline] Image generation failed for post #${task.sequence}:`, err instanceof Error ? err.message : err);
        // Continue — post will just have no image
      }
    }
  }

  const workers = Array.from({ length: Math.min(IMAGE_CONCURRENCY, tasks.length) }, () => processNext());
  await Promise.all(workers);
  return results;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const body = await req.json();
    const { productId, imageStyle, imageProvider, skipImages } = requestSchema.parse(body);

    // Load campaign
    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }

    const pipelineConfig = campaign.pipeline as PipelineConfig;
    if (!pipelineConfig) {
      throw new Error('VALIDATION_PIPELINE_CONFIG_MISSING');
    }

    // Load product
    const productRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');

    const product = productSnap.data()!;

    // Step 1: Research
    await campaignRef.update({ pipelineStatus: 'researching', updatedAt: new Date().toISOString() });

    const researchBrief: ResearchBrief = await researchForPipeline({
      productName: product.name,
      productDescription: product.description || '',
      productUrl: product.url || undefined,
      productCategories: product.categories || [],
      brandVoice: product.brandVoice || undefined,
    });

    await campaignRef.update({
      pipelineStatus: 'research_complete',
      researchBrief,
      updatedAt: new Date().toISOString(),
    });

    // Step 2: Generate posts
    await campaignRef.update({ pipelineStatus: 'generating', updatedAt: new Date().toISOString() });

    const posts = await generatePipelinePosts({
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      brandVoice: product.brandVoice || undefined,
      researchBrief,
      pipelineConfig,
    });

    // Step 3: Generate images for each post
    let imageMap = new Map<number, string>();
    if (!skipImages) {
      await campaignRef.update({ pipelineStatus: 'generating_images', updatedAt: new Date().toISOString() });

      // Pick the best aspect ratio for the primary channel
      const aspectRatioForChannel: Record<SocialChannel, ImageGenRequest['aspectRatio']> = {
        x: '16:9',
        facebook: '1:1',
        instagram: '4:5',
        tiktok: '9:16',
      };
      const primaryChannel = pipelineConfig.channels[0];

      const imageReq: Omit<ImageGenRequest, 'prompt'> = {
        style: imageStyle,
        aspectRatio: aspectRatioForChannel[primaryChannel] || '1:1',
        provider: imageProvider,
        brandIdentity: product.brandIdentity || undefined,
        brandVoice: product.brandVoice || undefined,
        productName: product.name,
        productDescription: product.description || '',
        productCategories: product.categories || [],
        productUrl: product.url || undefined,
        channel: primaryChannel,
      };

      const imageTasks = posts.map((p) => ({
        imagePrompt: p.imagePrompt,
        sequence: p.pipelineSequence,
      }));

      imageMap = await generateImagesWithConcurrency(imageTasks, imageReq, ctx.workspaceId);
    }

    // Step 4: Batch-write posts to Firestore
    const postsCol = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`);
    const now = new Date().toISOString();
    const primaryChannel = pipelineConfig.channels[0];
    const postIds: string[] = [];
    let imagesGenerated = 0;

    // Firestore batch max is 500 — pipeline posts are 15-30, so single batch is fine
    const batch = adminDb.batch();
    for (const post of posts) {
      const ref = postsCol.doc();
      postIds.push(ref.id);

      const imageUrl = imageMap.get(post.pipelineSequence);
      const mediaUrls = imageUrl ? [imageUrl] : [];
      if (imageUrl) imagesGenerated++;

      batch.set(ref, {
        content: post.content,
        channel: primaryChannel,
        status: 'draft',
        scheduledAt: null,
        mediaUrls,
        productId,
        generatedBy: 'pipeline',
        campaignId: id,
        pipelineStage: post.pipelineStage,
        pipelineSequence: post.pipelineSequence,
        pipelineTheme: post.pipelineTheme,
        targetChannels: pipelineConfig.channels,
        workspaceId: ctx.workspaceId,
        createdBy: ctx.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();

    // Update campaign status
    await campaignRef.update({
      pipelineStatus: 'generated',
      productId,
      updatedAt: new Date().toISOString(),
    });

    // Build stage breakdown
    const stageBreakdown: Record<string, number> = {};
    for (const post of posts) {
      stageBreakdown[post.pipelineStage] = (stageBreakdown[post.pipelineStage] || 0) + 1;
    }

    return apiOk({
      campaignId: id,
      postCount: posts.length,
      postIds,
      stages: stageBreakdown,
      imagesGenerated,
    });
  } catch (error) {
    // On failure, update campaign status
    try {
      const ctx = await requireContext(req);
      const { id } = await params;
      const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
      await campaignRef.update({ pipelineStatus: 'failed', updatedAt: new Date().toISOString() });
    } catch {
      // Ignore cleanup errors
    }
    return apiError(error);
  }
}
