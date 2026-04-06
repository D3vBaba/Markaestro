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
  spend: number;          // cents
  conversions: number;
  ctr: number;            // 0–1 decimal (e.g. 0.023 = 2.3%)
  cpc: number;            // cents per click
  roas: number;           // conversionValue / spend (e.g. 3.5 = 350% return)
  conversionValue: number; // cents of revenue attributed to conversions
  reach: number;          // unique users reached (Meta, TikTok)
  frequency: number;      // avg impressions per reached user (Meta)
  videoViews: number;     // 2-second video plays (TikTok) / 3-second plays (Meta)
  videoWatchTime: number; // avg seconds watched per view (TikTok)
  lastSyncedAt: string;
};

/** A single daily snapshot stored in the metrics_history subcollection. */
export type MetricsSnapshot = AdCampaignMetrics & {
  date: string; // YYYY-MM-DD
};

export type AdPlatformResult = {
  success: boolean;
  campaignId?: string;
  adSetId?: string;
  adGroupId?: string;
  adId?: string;
  error?: string;
};
