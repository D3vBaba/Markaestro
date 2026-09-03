import type { SocialChannel } from '@/lib/schemas';
import type { EvergreenQueueStatus, EvergreenReviewPolicy, EvergreenScheduleMode } from './schemas';

export type EvergreenEvidence = {
  capturedAt: string;
  sourcePublishedAt: string;
  metric: 'engagements' | 'views';
  value: number;
  sampleSize: number;
  explanation: string;
};

export type EvergreenQueue = {
  id: string;
  workspaceId: string;
  productId: string;
  sourcePostId: string;
  testMode: boolean;
  sourceSnapshot: {
    content: string;
    mediaUrls: string[];
    mediaAssetIds: string[];
    settings: Record<string, unknown> | null;
    settingsByChannel: Record<string, unknown>;
    channelDestinations: Record<string, unknown>;
    channelDeliveryModes: Record<string, unknown>;
    destinationId: string;
    destinationProvider: string;
    capturedAt: string;
    sourcePublishedAt: string;
  };
  name: string;
  status: EvergreenQueueStatus;
  channels: SocialChannel[];
  intervalDays: number;
  timeZone: string;
  localHour: number;
  localMinute: number;
  scheduleMode: EvergreenScheduleMode;
  reviewPolicy: EvergreenReviewPolicy;
  expiresAt: string | null;
  nextRunAt: string | null;
  version: number;
  runCount: number;
  consecutiveUnderperformingRuns: number;
  pauseReason: string | null;
  activationEvidence: EvergreenEvidence | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EvergreenVariant = {
  id: string;
  queueId: string;
  caption: string;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type EvergreenRunStatus =
  | 'planned'
  | 'needs_review'
  | 'scheduled'
  | 'published'
  | 'skipped'
  | 'failed'
  | 'evaluated';

export type EvergreenRun = {
  id: string;
  queueId: string;
  sourcePostId: string;
  occurrencePostId: string | null;
  variantId: string;
  plannedAt: string;
  status: EvergreenRunStatus;
  createdAt: string;
  updatedAt: string;
  evaluationDueAt: string | null;
  performanceIndex: number | null;
  reason: string | null;
};
