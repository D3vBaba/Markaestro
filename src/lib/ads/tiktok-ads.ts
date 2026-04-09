import type { AdCampaignDoc, AdPlatformResult, AdCampaignMetrics, PlatformCampaignSummary } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

const TIKTOK_ADS_API = 'https://business-api.tiktok.com/open_api/v1.3';

function mapObjectiveToTikTok(objective: AdCampaignObjective): string {
  const map: Record<AdCampaignObjective, string> = {
    awareness: 'REACH',
    traffic: 'TRAFFIC',
    engagement: 'ENGAGEMENT',
    leads: 'LEAD_GENERATION',
    conversions: 'WEB_CONVERSIONS',
    app_installs: 'APP_PROMOTION',
  };
  return map[objective] || 'TRAFFIC';
}

function mapOptimizationGoal(objective: AdCampaignObjective): string {
  switch (objective) {
    case 'awareness': return 'REACH';
    case 'traffic': return 'CLICK';
    case 'engagement': return 'ENGAGED_VIEW';
    case 'leads': return 'LEAD_GENERATION';
    case 'conversions': return 'CONVERSION';
    case 'app_installs': return 'INSTALL';
    default: return 'CLICK';
  }
}

/** Helper for TikTok Ads API calls. */
async function tiktokAdsCall(
  endpoint: string,
  accessToken: string,
  body: Record<string, unknown>,
  method: 'POST' | 'GET' = 'POST',
): Promise<{ data: Record<string, unknown>; error?: string }> {
  const res = await fetchWithRetry(`${TIKTOK_ADS_API}${endpoint}`, {
    method,
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();

  if (data.code !== 0) {
    const message = (data.message as string) || 'Unknown TikTok Ads error';
    return { data, error: `${message} (code: ${data.code})` };
  }
  return { data: data.data || data };
}

async function tiktokAdsGet(
  endpoint: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<{ data: Record<string, unknown>; error?: string }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchWithRetry(`${TIKTOK_ADS_API}${endpoint}?${qs}`, {
    headers: { 'Access-Token': accessToken },
  });
  const data = await res.json();
  if (data.code !== 0) {
    return { data, error: (data.message as string) || 'Unknown error' };
  }
  return { data: data.data || data };
}

function buildTikTokTargeting(campaign: AdCampaignDoc): Record<string, unknown> {
  const targeting: Record<string, unknown> = {};
  const t = campaign.targeting;
  if (!t) return targeting;

  // Age groups — TikTok uses predefined ranges
  if (t.ageMin || t.ageMax) {
    const ageGroups: string[] = [];
    const ranges = [
      { id: 'AGE_13_17', min: 13, max: 17 },
      { id: 'AGE_18_24', min: 18, max: 24 },
      { id: 'AGE_25_34', min: 25, max: 34 },
      { id: 'AGE_35_44', min: 35, max: 44 },
      { id: 'AGE_45_54', min: 45, max: 54 },
      { id: 'AGE_55_100', min: 55, max: 100 },
    ];
    for (const r of ranges) {
      if (r.max >= (t.ageMin || 13) && r.min <= (t.ageMax || 65)) {
        ageGroups.push(r.id);
      }
    }
    if (ageGroups.length) targeting.age_groups = ageGroups;
  }

  // Gender: TikTok uses GENDER_MALE, GENDER_FEMALE
  if (t.gender && t.gender !== 'all') {
    targeting.gender = t.gender === 'male' ? 'GENDER_MALE' : 'GENDER_FEMALE';
  }

  // Locations — TikTok uses location IDs but we'll pass country codes
  if (t.locations?.length) {
    targeting.location_ids = t.locations;
  }

  return targeting;
}

/**
 * Create a full ad campaign on TikTok Ads API.
 * 3-step flow: Campaign → Ad Group → Ad.
 * All objects are created DISABLE so the user can review before activating.
 */
export async function createTikTokCampaign(
  accessToken: string,
  advertiserId: string,
  campaign: AdCampaignDoc,
): Promise<AdPlatformResult> {
  try {
    // Step 1: Create Campaign
    const step1 = await tiktokAdsCall('/campaign/create/', accessToken, {
      advertiser_id: advertiserId,
      campaign_name: campaign.name,
      objective_type: mapObjectiveToTikTok(campaign.objective),
      budget_mode: 'BUDGET_MODE_DAY',
      budget: campaign.dailyBudgetCents / 100, // TikTok expects dollars
      operation_status: 'DISABLE',
    });
    if (step1.error) {
      return { success: false, error: `Campaign creation failed: ${step1.error}` };
    }
    const campaignId = step1.data.campaign_id as string;

    // Step 2: Create Ad Group
    const targeting = buildTikTokTargeting(campaign);
    const scheduleStart = new Date(campaign.startDate);
    const scheduleStartStr = scheduleStart.toISOString().replace('T', ' ').substring(0, 19);

    const adGroupBody: Record<string, unknown> = {
      advertiser_id: advertiserId,
      campaign_id: campaignId,
      adgroup_name: `${campaign.name} - Ad Group`,
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      optimization_goal: mapOptimizationGoal(campaign.objective),
      bid_type: 'BID_TYPE_NO_BID',
      budget_mode: 'BUDGET_MODE_DAY',
      budget: campaign.dailyBudgetCents / 100,
      schedule_type: 'SCHEDULE_START_END',
      schedule_start_time: scheduleStartStr,
      operation_status: 'DISABLE',
      ...targeting,
    };

    if (campaign.endDate) {
      const scheduleEnd = new Date(campaign.endDate);
      adGroupBody.schedule_end_time = scheduleEnd.toISOString().replace('T', ' ').substring(0, 19);
    }

    // If destination URL is provided, set it
    if (campaign.creative.linkUrl) {
      adGroupBody.landing_page_url = campaign.creative.linkUrl;
    }

    const step2 = await tiktokAdsCall('/adgroup/create/', accessToken, adGroupBody);
    if (step2.error) {
      return { success: false, campaignId, error: `Ad group creation failed: ${step2.error}` };
    }
    const adGroupId = step2.data.adgroup_id as string;

    // Step 3: Create Ad
    const adBody: Record<string, unknown> = {
      advertiser_id: advertiserId,
      adgroup_id: adGroupId,
      ad_name: `${campaign.name} - Ad`,
      ad_format: 'SINGLE_VIDEO',
      ad_text: campaign.creative.primaryText.substring(0, 100),
      call_to_action: campaign.creative.ctaType || 'LEARN_MORE',
      operation_status: 'DISABLE',
    };

    // If video creative is provided
    if (campaign.creative.videoUrl) {
      adBody.video_id = campaign.creative.videoUrl; // Assumes video_id after upload
    }

    // If image creative is provided (for carousel/image ads)
    if (campaign.creative.imageUrl && !campaign.creative.videoUrl) {
      adBody.ad_format = 'SINGLE_IMAGE';
      adBody.image_ids = [campaign.creative.imageUrl]; // Assumes image_id after upload
    }

    if (campaign.creative.linkUrl) {
      adBody.landing_page_url = campaign.creative.linkUrl;
    }

    const step3 = await tiktokAdsCall('/ad/create/', accessToken, adBody);
    if (step3.error) {
      return { success: false, campaignId, adGroupId, error: `Ad creation failed: ${step3.error}` };
    }
    const adId = step3.data.ad_id as string;

    return { success: true, campaignId, adGroupId, adId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error creating TikTok campaign',
    };
  }
}

/**
 * Update a TikTok campaign status (DISABLE or ENABLE).
 */
export async function updateTikTokCampaignStatus(
  accessToken: string,
  advertiserId: string,
  campaignId: string,
  status: 'DISABLE' | 'ENABLE',
): Promise<{ success: boolean; error?: string }> {
  const result = await tiktokAdsCall('/campaign/status/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: status,
  });
  if (result.error) return { success: false, error: result.error };
  return { success: true };
}

/**
 * Fetch campaign performance metrics from TikTok Ads Reporting API.
 */
export async function getTikTokCampaignMetrics(
  accessToken: string,
  advertiserId: string,
  campaignId: string,
): Promise<{ success: boolean; metrics?: AdCampaignMetrics; error?: string }> {
  try {
    const result = await tiktokAdsGet('/report/integrated/get/', accessToken, {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      dimensions: JSON.stringify(['campaign_id']),
      metrics: JSON.stringify([
        'impressions', 'clicks', 'spend', 'conversion', 'ctr', 'cpc',
        'reach', 'video_play_actions', 'average_video_play_per_user', 'total_purchase_value',
      ]),
      data_level: 'AUCTION_CAMPAIGN',
      lifetime: 'true',
      filters: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campaignId]) }]),
    });

    if (result.error) return { success: false, error: result.error };

    const rows = result.data.list as Array<{ metrics: Record<string, string> }> | undefined;
    const row = rows?.[0]?.metrics;
    if (!row) return { success: true, metrics: undefined };

    const spend = Math.round(Number(row.spend) * 100);
    const conversionValue = Math.round(Number(row.total_purchase_value || 0) * 100);
    const impressions = Number(row.impressions) || 0;
    const reach = Number(row.reach) || 0;

    return {
      success: true,
      metrics: {
        impressions,
        clicks: Number(row.clicks) || 0,
        spend,
        conversions: Number(row.conversion) || 0,
        ctr: Number(row.ctr) || 0,
        cpc: Math.round(Number(row.cpc) * 100),
        roas: spend > 0 ? conversionValue / spend : 0,
        conversionValue,
        reach,
        frequency: reach > 0 ? impressions / reach : 0,
        videoViews: Number(row.video_play_actions) || 0,
        videoWatchTime: Number(row.average_video_play_per_user) || 0,
        lastSyncedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * List all active/paused campaigns for a TikTok advertiser account.
 */
export async function listTikTokCampaigns(
  accessToken: string,
  advertiserId: string,
): Promise<{ success: boolean; campaigns?: PlatformCampaignSummary[]; error?: string }> {
  try {
    const result = await tiktokAdsGet('/campaign/get/', accessToken, {
      advertiser_id: advertiserId,
      fields: JSON.stringify(['campaign_id', 'campaign_name', 'status', 'objective_type', 'budget', 'budget_mode', 'create_time', 'modify_time']),
      page_size: '500',
    });

    if (result.error) return { success: false, error: result.error };

    type TikTokCampaign = {
      campaign_id: string;
      campaign_name: string;
      status: string;
      objective_type: string;
      budget: number;
      budget_mode: string;
    };

    const list = (result.data.list as TikTokCampaign[]) || [];

    const objectiveMap: Record<string, string> = {
      REACH: 'awareness',
      VIDEO_VIEWS: 'engagement',
      TRAFFIC: 'traffic',
      ENGAGEMENT: 'engagement',
      LEAD_GENERATION: 'leads',
      WEB_CONVERSIONS: 'conversions',
      APP_PROMOTION: 'app_installs',
      PRODUCT_SALES: 'conversions',
      SHOP_PURCHASES: 'conversions',
    };

    const statusMap: Record<string, 'active' | 'paused' | 'completed'> = {
      CAMPAIGN_STATUS_ENABLE: 'active',
      CAMPAIGN_STATUS_DISABLE: 'paused',
      CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY: 'paused',
      CAMPAIGN_STATUS_ALL: 'active',
    };

    const campaigns: PlatformCampaignSummary[] = list
      .filter((c) => c.status !== 'CAMPAIGN_STATUS_DELETE')
      .map((c) => ({
        externalCampaignId: c.campaign_id,
        name: c.campaign_name,
        status: statusMap[c.status] || 'paused',
        objective: objectiveMap[c.objective_type] || 'traffic',
        // TikTok budget is in account currency (usually dollars); convert to cents
        dailyBudgetCents: c.budget_mode === 'BUDGET_MODE_DAY' ? Math.round(c.budget * 100) : 0,
      }));

    return { success: true, campaigns };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
