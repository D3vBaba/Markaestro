import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { researchForPipeline, buildImageResearchContext } from '@/lib/ai/pipeline-researcher';
import {
  generatePipelinePosts,
  expandPipelineImageTemplate,
} from '@/lib/ai/pipeline-generator';
import { getMostRestrictiveChannel } from '@/lib/ai/pipeline-channels';
import { generateAndUploadImage, type ImageGenRequest } from '@/lib/ai/image-generator';
import { buildGenerationConfigSnapshot, hashObject } from '@/lib/campaign-runs';
import { generatePipelineRequestSchema } from '@/lib/schemas';
import type { PipelineConfig, ResearchBrief, SocialChannel, ImageSubtype, PromptMode } from '@/lib/schemas';

export const runtime = 'nodejs';


const IMAGE_CONCURRENCY = 3;
const MAX_IMAGE_ERROR_SAMPLES = 8;

function buildFallbackResearchBrief(): ResearchBrief {
  return {
    competitors: [],
    trends: [],
    productInsights: {
      keyMessages: [],
      uniqueValueProp: '',
      audiencePainPoints: [],
      toneRecommendations: '',
    },
    newsHookHeadlines: [],
    sources: [],
    generatedAt: new Date().toISOString(),
  };
}

type ImageGenTask = {
  sequence: number;
  prompt: string;
  promptMode: PromptMode;
  customPrompt?: string;
  subtype?: ImageSubtype;
};

async function generateImagesWithConcurrency(
  tasks: ImageGenTask[],
  imageReq: Omit<ImageGenRequest, 'prompt' | 'subtype' | 'promptMode' | 'customPrompt'>,
  workspaceId: string,
): Promise<{ urlBySequence: Map<number, string>; failures: Array<{ sequence: number; message: string }> }> {
  const urlBySequence = new Map<number, string>();
  const failures: Array<{ sequence: number; message: string }> = [];
  const queue = [...tasks];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const task = queue.shift()!;
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await generateAndUploadImage(
            {
              ...imageReq,
              prompt: task.prompt,
              promptMode: task.promptMode,
              customPrompt: task.customPrompt,
              subtype: task.subtype,
            },
            workspaceId,
          );
          urlBySequence.set(task.sequence, result.imageUrl);
          lastErr = '';
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          console.error(
            `[pipeline] Image generation attempt ${attempt + 1} failed for post #${task.sequence}:`,
            lastErr,
          );
        }
      }
      if (!urlBySequence.has(task.sequence)) {
        failures.push({ sequence: task.sequence, message: lastErr || 'unknown error' });
      }
    }
  }

  const workers = Array.from({ length: Math.min(IMAGE_CONCURRENCY, tasks.length) }, () => processNext());
  await Promise.all(workers);
  return { urlBySequence, failures };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let workspaceIdForFailure: string | null = null;
  let campaignIdForFailure: string | null = null;
  let latestRunIdForFailure: string | null = null;

  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');
    const { id } = await params;
    workspaceIdForFailure = ctx.workspaceId;
    campaignIdForFailure = id;
    const body = await req.json();
    const {
      productId,
      imageStyle,
      imageProvider,
      imageSubtypes: selectedSubtypes,
      skipImages,
      creativeBrief,
      imagePromptMode,
      imageCustomTemplate,
      postCopyMode,
      postOutline,
      imageChannelMode,
      optimizeImagesForChannel,
    } = generatePipelineRequestSchema.parse(body);

    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }
    if (['researching', 'generating', 'generating_images'].includes(campaign.pipelineStatus || '')) {
      throw new Error('VALIDATION_PIPELINE_GENERATION_ALREADY_RUNNING');
    }

    const pipelineConfig = campaign.pipeline as PipelineConfig;
    if (!pipelineConfig) {
      throw new Error('VALIDATION_PIPELINE_CONFIG_MISSING');
    }

    if (
      imageChannelMode === 'manual' &&
      optimizeImagesForChannel &&
      !pipelineConfig.channels.includes(optimizeImagesForChannel)
    ) {
      throw new Error('VALIDATION_IMAGE_CHANNEL_NOT_IN_CAMPAIGN');
    }

    const productRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const product = productSnap.data()!;

    const previousActiveRunId = campaign.activeRunId as string | undefined;
    const previousScheduledRunId = campaign.scheduledRunId as string | undefined;
    const configVersion = Number(campaign.configVersion || 1);
    const runRef = campaignRef.collection('runs').doc();
    latestRunIdForFailure = runRef.id;
    const runNow = new Date().toISOString();
    const configSnapshot = buildGenerationConfigSnapshot({
      productId,
      pipeline: pipelineConfig,
      imageStyle,
      imageProvider,
      imageSubtypes: selectedSubtypes,
      skipImages,
      creativeBrief,
      imagePromptMode,
      imageCustomTemplate,
      postCopyMode,
      postOutline,
      imageChannelMode,
      optimizeImagesForChannel,
    });

    await runRef.set({
      campaignId: id,
      operationType: 'full_regenerate',
      status: 'researching',
      configVersion,
      configSnapshot,
      configHash: hashObject(configSnapshot),
      parentRunId: previousActiveRunId || null,
      createdBy: ctx.uid,
      createdAt: runNow,
      updatedAt: runNow,
    });

    await campaignRef.update({
      pipelineStatus: 'researching',
      latestRunId: runRef.id,
      updatedAt: runNow,
    });

    let researchBrief: ResearchBrief;
    try {
      researchBrief = await researchForPipeline({
        productId,
        productName: product.name,
        productDescription: product.description || '',
        productUrl: product.url || undefined,
        productCategories: product.categories || [],
        brandVoice: product.brandVoice || undefined,
      });
    } catch (error) {
      console.error(
        `[pipeline] Research failed for campaign ${id}, continuing without market research:`,
        error instanceof Error ? error.message : error,
      );
      researchBrief = buildFallbackResearchBrief();
    }

    const afterResearchAt = new Date().toISOString();
    await campaignRef.update({
      pipelineStatus: 'research_complete',
      researchBrief,
      latestRunId: runRef.id,
      updatedAt: afterResearchAt,
    });
    await runRef.update({
      status: 'generating_copy',
      researchSnapshot: researchBrief,
      researchHash: hashObject(researchBrief),
      updatedAt: afterResearchAt,
    });

    await campaignRef.update({ pipelineStatus: 'generating', updatedAt: new Date().toISOString() });

    const posts = await generatePipelinePosts({
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      brandVoice: product.brandVoice || undefined,
      researchBrief,
      pipelineConfig,
      creativeBrief,
      postCopyMode,
      postOutline,
    });

    let imageMap = new Map<number, string>();
    let imageFailures: Array<{ sequence: number; message: string }> = [];
    if (!skipImages) {
      const imageStageAt = new Date().toISOString();
      await campaignRef.update({ pipelineStatus: 'generating_images', updatedAt: imageStageAt });
      await runRef.update({ status: 'generating_images', updatedAt: imageStageAt });

      const aspectRatioForChannel: Record<SocialChannel, ImageGenRequest['aspectRatio']> = {
        facebook: '1:1',
        instagram: '4:5',
        tiktok: '9:16',
        linkedin: '1:1',
      };
      const imageFramingChannel: SocialChannel =
        imageChannelMode === 'manual' && optimizeImagesForChannel
          ? optimizeImagesForChannel
          : getMostRestrictiveChannel(pipelineConfig.channels);

      const imageReq: Omit<ImageGenRequest, 'prompt' | 'subtype' | 'promptMode' | 'customPrompt'> = {
        style: imageStyle,
        aspectRatio: aspectRatioForChannel[imageFramingChannel] || '1:1',
        provider: imageProvider,
        brandIdentity: product.brandIdentity || undefined,
        brandVoice: product.brandVoice || undefined,
        productName: product.name,
        productDescription: product.description || '',
        productCategories: product.categories || [],
        productUrl: product.url || undefined,
        channel: imageFramingChannel,
        researchContext: buildImageResearchContext(researchBrief),
      };

      const template = imageCustomTemplate?.trim() || '';
      const imageTasks: ImageGenTask[] = posts.map((p, i) => {
        const expanded = template ? expandPipelineImageTemplate(template, p) : '';
        let promptMode: PromptMode = 'guided';
        const prompt = p.imagePrompt;
        let customPrompt: string | undefined;

        if (imagePromptMode === 'custom_override' && expanded) {
          promptMode = 'custom_override';
          customPrompt = expanded;
        } else if (imagePromptMode === 'hybrid' && expanded) {
          promptMode = 'hybrid';
          customPrompt = expanded;
        }

        return {
          sequence: p.pipelineSequence,
          prompt,
          promptMode,
          customPrompt,
          subtype:
            selectedSubtypes.length > 0 ? selectedSubtypes[i % selectedSubtypes.length] : undefined,
        };
      });

      const { urlBySequence, failures } = await generateImagesWithConcurrency(
        imageTasks,
        imageReq,
        ctx.workspaceId,
      );
      imageMap = urlBySequence;
      imageFailures = failures;
    }

    const postsCol = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`);
    const writeNow = new Date().toISOString();
    const primaryChannel = getMostRestrictiveChannel(pipelineConfig.channels);
    const postIds: string[] = [];
    let imagesGenerated = 0;

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
        generationRunId: runRef.id,
        generationConfigVersion: configVersion,
        pipelineStage: post.pipelineStage,
        pipelineSequence: post.pipelineSequence,
        pipelineTheme: post.pipelineTheme,
        targetChannels: pipelineConfig.channels,
        workspaceId: ctx.workspaceId,
        createdBy: ctx.uid,
        createdAt: writeNow,
        updatedAt: writeNow,
      });
    }
    await batch.commit();

    const stageBreakdown: Record<string, number> = {};
    for (const post of posts) {
      stageBreakdown[post.pipelineStage] = (stageBreakdown[post.pipelineStage] || 0) + 1;
    }

    const imagesFailed = imageFailures.length;
    const imageErrorSamples = imageFailures.slice(0, MAX_IMAGE_ERROR_SAMPLES).map(
      (f) => `#${f.sequence}: ${f.message}`,
    );

    const readyAt = new Date().toISOString();
    await runRef.update({
      status: 'ready',
      itemCounts: {
        total: posts.length,
        byStage: stageBreakdown,
        imagesGenerated,
        imagesFailed,
        ...(imageErrorSamples.length > 0 ? { imageErrorSamples } : {}),
      },
      updatedAt: readyAt,
    });

    await campaignRef.update({
      pipelineStatus: 'generated',
      productId,
      activeRunId: runRef.id,
      latestRunId: runRef.id,
      configDirty: false,
      configDirtyReason: null,
      updatedAt: readyAt,
    });

    if (previousActiveRunId && previousActiveRunId !== runRef.id && previousActiveRunId !== previousScheduledRunId) {
      await campaignRef.collection('runs').doc(previousActiveRunId).set({
        status: 'superseded',
        updatedAt: readyAt,
      }, { merge: true });
    }

    return apiOk({
      campaignId: id,
      runId: runRef.id,
      postCount: posts.length,
      postIds,
      stages: stageBreakdown,
      imagesGenerated,
      imagesFailed,
      imageErrorSamples,
    });
  } catch (error) {
    if (workspaceIdForFailure && campaignIdForFailure) {
      try {
        const campaignRef = adminDb.doc(`${workspaceCollection(workspaceIdForFailure, 'campaigns')}/${campaignIdForFailure}`);
        await campaignRef.update({ pipelineStatus: 'failed', updatedAt: new Date().toISOString() });
        if (latestRunIdForFailure) {
          await campaignRef.collection('runs').doc(latestRunIdForFailure).set({
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    return apiError(error);
  }
}
