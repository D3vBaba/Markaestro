import type { AdPlatform, AdCampaignStatus, AdCampaignObjective, AdTargeting, AdCreative } from '@/lib/schemas';

export type AdCampaignDoc = {
  workspaceId: string;
  name: string;
  platform: AdPlatform;
  objective: AdCampaignObjective;
  status: AdCampaignStatus;
  dailyBudgetCents: number;
  startDate: string;
  endDate?: string | null;
  targeting?: AdTargeting;
  creative: AdCreative;
  productId?: string;

  // External platform IDs (populated after launch)
  externalCampaignId?: string;
  externalAdSetId?: string;
  externalAdId?: string;
  errorMessage?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  launchedAt?: string;
};

export type AdPlatformResult = {
  success: boolean;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  error?: string;
};
