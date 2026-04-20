import crypto from 'crypto';
import type { PipelineConfig } from '@/lib/schemas';

export const generationRunStatuses = [
  'queued',
  'researching',
  'generating_copy',
  'generating_images',
  'ready',
  'scheduled',
  'superseded',
  'failed',
] as const;

export const generationOperationTypes = [
  'full_regenerate',
  'regenerate_copy',
  'regenerate_images',
  'reschedule_only',
  'refresh_research',
] as const;

export type GenerationRunStatus = (typeof generationRunStatuses)[number];
export type GenerationOperationType = (typeof generationOperationTypes)[number];

export type CampaignGenerationConfigSnapshot = {
  productId?: string;
  pipeline: PipelineConfig | null;
  imageStyle?: string;
  imageProvider?: string;
  imageSubtypes?: string[];
  skipImages?: boolean;
  /** User-supplied direction injected into post generation */
  creativeBrief?: string;
  /** guided | custom_override | hybrid — same values as pipeline API */
  imagePromptMode?: string;
  /** Template or suffix for custom / hybrid image modes */
  imageCustomTemplate?: string;
  postCopyMode?: string;
  postOutline?: string;
  imageChannelMode?: string;
  optimizeImagesForChannel?: string;
  /** Pool of user-uploaded media URLs used in place of AI generation */
  userMediaUrls?: string[];
};

export type CampaignGenerationRun = {
  id?: string;
  campaignId: string;
  operationType: GenerationOperationType;
  status: GenerationRunStatus;
  configVersion: number;
  configSnapshot: CampaignGenerationConfigSnapshot;
  configHash: string;
  researchSnapshot?: unknown;
  researchHash?: string | null;
  parentRunId?: string | null;
  itemCounts?: {
    total: number;
    byStage: Record<string, number>;
    imagesGenerated: number;
    imagesFailed?: number;
    imageErrorSamples?: string[];
  };
  errorMessage?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, normalizeValue(v)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function hashObject(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function buildGenerationConfigSnapshot(input: CampaignGenerationConfigSnapshot): CampaignGenerationConfigSnapshot {
  return {
    productId: input.productId || undefined,
    pipeline: input.pipeline || null,
    imageStyle: input.imageStyle || undefined,
    imageProvider: input.imageProvider || undefined,
    imageSubtypes: input.imageSubtypes && input.imageSubtypes.length > 0 ? input.imageSubtypes : undefined,
    skipImages: input.skipImages || undefined,
    creativeBrief: input.creativeBrief?.trim() || undefined,
    imagePromptMode: input.imagePromptMode || undefined,
    imageCustomTemplate: input.imageCustomTemplate?.trim() || undefined,
    postCopyMode: input.postCopyMode || undefined,
    postOutline: input.postOutline?.trim() || undefined,
    imageChannelMode: input.imageChannelMode || undefined,
    optimizeImagesForChannel: input.optimizeImagesForChannel || undefined,
    userMediaUrls:
      input.userMediaUrls && input.userMediaUrls.length > 0 ? input.userMediaUrls : undefined,
  };
}

export function classifyPipelineChange(
  previous: CampaignGenerationConfigSnapshot,
  next: CampaignGenerationConfigSnapshot,
): GenerationOperationType {
  const prevSchedule = {
    cadence: previous.pipeline?.cadence,
    startDate: previous.pipeline?.startDate,
    postTimeHourUTC: previous.pipeline?.postTimeHourUTC,
  };
  const nextSchedule = {
    cadence: next.pipeline?.cadence,
    startDate: next.pipeline?.startDate,
    postTimeHourUTC: next.pipeline?.postTimeHourUTC,
  };

  const prevImage = {
    imageStyle: previous.imageStyle,
    imageProvider: previous.imageProvider,
    imageSubtypes: previous.imageSubtypes || [],
    skipImages: previous.skipImages || false,
    creativeBrief: previous.creativeBrief || '',
    imagePromptMode: previous.imagePromptMode || 'guided',
    imageCustomTemplate: previous.imageCustomTemplate || '',
    postCopyMode: previous.postCopyMode || 'ai_generated',
    postOutline: previous.postOutline || '',
    imageChannelMode: previous.imageChannelMode || 'auto',
    optimizeImagesForChannel: previous.optimizeImagesForChannel || '',
  };
  const nextImage = {
    imageStyle: next.imageStyle,
    imageProvider: next.imageProvider,
    imageSubtypes: next.imageSubtypes || [],
    skipImages: next.skipImages || false,
    creativeBrief: next.creativeBrief || '',
    imagePromptMode: next.imagePromptMode || 'guided',
    imageCustomTemplate: next.imageCustomTemplate || '',
    postCopyMode: next.postCopyMode || 'ai_generated',
    postOutline: next.postOutline || '',
    imageChannelMode: next.imageChannelMode || 'auto',
    optimizeImagesForChannel: next.optimizeImagesForChannel || '',
  };

  const prevPipelineContent = {
    productId: previous.productId,
    channels: previous.pipeline?.channels || [],
    stages: previous.pipeline?.stages || [],
    postCount: previous.pipeline?.postCount,
  };
  const nextPipelineContent = {
    productId: next.productId,
    channels: next.pipeline?.channels || [],
    stages: next.pipeline?.stages || [],
    postCount: next.pipeline?.postCount,
  };

  if (hashObject(prevSchedule) !== hashObject(nextSchedule) && hashObject(prevPipelineContent) === hashObject(nextPipelineContent) && hashObject(prevImage) === hashObject(nextImage)) {
    return 'reschedule_only';
  }
  if (hashObject(prevImage) !== hashObject(nextImage) && hashObject(prevPipelineContent) === hashObject(nextPipelineContent)) {
    return 'regenerate_images';
  }
  if (hashObject(prevPipelineContent) !== hashObject(nextPipelineContent) && previous.productId === next.productId) {
    return 'regenerate_copy';
  }
  return 'full_regenerate';
}
