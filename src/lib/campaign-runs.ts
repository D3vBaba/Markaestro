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
  };
  const nextImage = {
    imageStyle: next.imageStyle,
    imageProvider: next.imageProvider,
    imageSubtypes: next.imageSubtypes || [],
    skipImages: next.skipImages || false,
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
