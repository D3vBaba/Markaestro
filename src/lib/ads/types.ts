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
  adAccountId?: string;  // Meta: overrides product connection's adAccountId
  customerId?: string;   // Google Ads: overrides connection's customerId

  // External platform IDs (populated after launch)
  externalCampaignId?: string;
  externalAdSetId?: string;
  externalAdGroupId?: string;
  externalAdId?: string;
  errorMessage?: string;

  // Performance metrics (updated by sync job)
  metrics?: AdCampaignMetrics;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  launchedAt?: string;
};

export type AdCampaignMetrics = {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  lastSyncedAt: string;
};

export type AdPlatformResult = {
  success: boolean;
  campaignId?: string;
  adSetId?: string;
  adGroupId?: string;
  adId?: string;
  error?: string;
};
