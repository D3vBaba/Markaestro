import type { AdCampaignDoc, AdPlatformResult, AdCampaignMetrics, PlatformCampaignSummary } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

const META_GRAPH_API = 'https://graph.facebook.com/v22.0';
const META_SUPPORTED_OBJECTIVES: AdCampaignObjective[] = ['awareness', 'traffic', 'engagement'];

export function isMetaObjectiveSupported(objective: AdCampaignObjective): boolean {
  return META_SUPPORTED_OBJECTIVES.includes(objective);
}

/**
 * Map generic objectives to Meta Marketing API OUTCOME_* values.
 */
function mapObjectiveToMeta(objective: AdCampaignObjective): string {
  const map: Record<AdCampaignObjective, string> = {
    awareness: 'OUTCOME_AWARENESS',
    traffic: 'OUTCOME_TRAFFIC',
    engagement: 'OUTCOME_ENGAGEMENT',
    leads: 'OUTCOME_LEADS',
    conversions: 'OUTCOME_SALES',
    app_installs: 'OUTCOME_APP_PROMOTION',
  };
  return map[objective] || 'OUTCOME_TRAFFIC';
}

/** Helper to make Meta API calls with consistent error handling. */
async function metaApiCall(
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; error?: string }> {
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });
  const data = await res.json();
  if (data.error) {
    const err = data.error as Record<string, unknown>;
    const parts = [
      err.error_user_msg as string | undefined,
      err.message as string | undefined,
      err.error_data && typeof err.error_data === 'object'
        ? JSON.stringify(err.error_data)
        : undefined,
      err.code ? `code=${String(err.code)}` : undefined,
      err.error_subcode ? `subcode=${String(err.error_subcode)}` : undefined,
    ].filter(Boolean);
    return { data, error: parts.join(' | ') || 'Unknown Meta API error' };
  }
  return { data };
}

function getMetaAdSetConfig(
  objective: AdCampaignObjective,
): { optimizationGoal: string; billingEvent: string } {
  switch (objective) {
    case 'awareness':
      return { optimizationGoal: 'REACH', billingEvent: 'IMPRESSIONS' };
    case 'engagement':
      return { optimizationGoal: 'POST_ENGAGEMENT', billingEvent: 'IMPRESSIONS' };
    case 'traffic':
    default:
      return { optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS' };
  }
}

function buildMetaTargeting(campaign: AdCampaignDoc): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    // We currently build manual audiences, so explicitly opt out of Advantage+ Audience.
    targeting_automation: {
      advantage_audience: 0,
    },
  };
  const t = campaign.targeting;
  if (t) {
    if (t.ageMin) targeting.age_min = t.ageMin;
    if (t.ageMax) targeting.age_max = t.ageMax;
    if (t.gender !== 'all') {
      targeting.genders = t.gender === 'male' ? [1] : [2];
    }
    if (t.locations?.length > 0) {
      targeting.geo_locations = { countries: t.locations };
    }

    const interestIds = (t.interests || [])
      .map((interest) => String(interest).trim())
      .filter((interest) => /^\d+$/.test(interest));

    // Meta Marketing API targeting expects taxonomy IDs, not free-form names.
    if (interestIds.length > 0) {
      targeting.flexible_spec = [{
        interests: interestIds.map((id) => ({ id })),
      }];
    }
  }
  if (!targeting.geo_locations) {
    targeting.geo_locations = { countries: ['US'] };
  }
  return targeting;
}

function normalizeMetaSchedule(campaign: AdCampaignDoc): { startTime: string; endTime?: string } {
  const now = Date.now();
  const minStart = new Date(now + 5 * 60 * 1000);
  const requestedStart = new Date(campaign.startDate);
  const safeStart = Number.isNaN(requestedStart.getTime()) || requestedStart < minStart
    ? minStart
    : requestedStart;

  const endDate = campaign.endDate ? new Date(campaign.endDate) : null;
  const endTime = endDate && !Number.isNaN(endDate.getTime()) && endDate > safeStart
    ? endDate.toISOString()
    : undefined;

  return { startTime: safeStart.toISOString(), endTime };
}

function compactMetaFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function extractMetaImageHash(data: Record<string, unknown>): string | undefined {
  const images = data.images;
  if (!images || typeof images !== 'object') {
    return undefined;
  }

  for (const image of Object.values(images as Record<string, unknown>)) {
    if (!image || typeof image !== 'object') {
      continue;
    }

    const hash = (image as Record<string, unknown>).hash;
    if (typeof hash === 'string' && hash.trim()) {
      return hash;
    }
  }

  return undefined;
}

async function resolveMetaImageAsset(
  accessToken: string,
  actId: string,
  imageUrl: string,
): Promise<Record<string, unknown>> {
  const upload = await metaApiCall(`${META_GRAPH_API}/${actId}/adimages`, accessToken, {
    url: imageUrl,
  });

  if (!upload.error) {
    const imageHash = extractMetaImageHash(upload.data);
    if (imageHash) {
      return { image_hash: imageHash };
    }
  }

  // Fallback to a direct picture URL when Meta does not return an image hash.
  return { picture: imageUrl };
}

async function buildMetaCreativeSpec(
  accessToken: string,
  actId: string,
  pageId: string,
  campaign: AdCampaignDoc,
): Promise<{ spec?: Record<string, unknown>; error?: string }> {
  const primaryImageUrl = campaign.creative.imageUrl?.trim();
  const extraImageUrls = (campaign.creative.imageUrls ?? [])
    .map((u) => u.trim())
    .filter((u) => !!u);

  // Deduplicate while preserving order, primary first.
  const seen = new Set<string>();
  const allImageUrls = [primaryImageUrl, ...extraImageUrls]
    .filter((u): u is string => !!u)
    .filter((u) => (seen.has(u) ? false : (seen.add(u), true)));

  const videoUrl = campaign.creative.videoUrl?.trim();

  if (allImageUrls.length > 0 && videoUrl) {
    return {
      error: 'Meta ads currently support either images or a video per ad, not both. Remove one and try again.',
    };
  }

  if (videoUrl) {
    return {
      error: 'Meta video creatives are not configured yet. Use an image creative for now.',
    };
  }

  const callToAction = campaign.creative.ctaType
    ? {
      type: campaign.creative.ctaType,
      value: {
        link: campaign.creative.linkUrl,
      },
    }
    : undefined;

  // Carousel: 2–10 images → child_attachments
  // Meta requires 2 minimum for a carousel ad.
  if (allImageUrls.length >= 2) {
    const MAX_CAROUSEL = 10;
    const urls = allImageUrls.slice(0, MAX_CAROUSEL);
    const assets = await Promise.all(urls.map((url) => resolveMetaImageAsset(accessToken, actId, url)));

    const child_attachments = assets.map((asset) =>
      compactMetaFields({
        link: campaign.creative.linkUrl,
        name: campaign.creative.headline,
        description: campaign.creative.description,
        call_to_action: callToAction,
        ...asset,
      }),
    );

    return {
      spec: {
        page_id: pageId,
        link_data: compactMetaFields({
          message: campaign.creative.primaryText,
          link: campaign.creative.linkUrl,
          caption: campaign.creative.description,
          child_attachments,
          multi_share_optimized: true,
          multi_share_end_card: true,
          call_to_action: callToAction,
        }),
      },
    };
  }

  // Single image (or text-only — though link_data still needs a link)
  const imageAsset = allImageUrls[0]
    ? await resolveMetaImageAsset(accessToken, actId, allImageUrls[0])
    : {};

  return {
    spec: {
      page_id: pageId,
      link_data: compactMetaFields({
        message: campaign.creative.primaryText,
        link: campaign.creative.linkUrl,
        name: campaign.creative.headline,
        description: campaign.creative.description,
        call_to_action: callToAction,
        ...imageAsset,
      }),
    },
  };
}

/**
 * Create a full ad campaign on Meta Marketing API.
 * 4-step flow: Campaign → Ad Set → Creative → Ad.
 * All objects are created PAUSED so the user can review before activating.
 */
export async function createMetaCampaign(
  accessToken: string,
  adAccountId: string,
  pageId: string,
  campaign: AdCampaignDoc,
): Promise<AdPlatformResult> {
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  try {
    if (!isMetaObjectiveSupported(campaign.objective)) {
      return {
        success: false,
        error: 'Meta currently supports awareness, traffic, and engagement campaigns only. Conversions, leads, and app installs require additional setup that is not configured yet.',
      };
    }
    if (!campaign.creative.linkUrl) {
      return { success: false, error: 'Meta ads require a destination URL' };
    }

    // Step 1: Create Campaign (PAUSED)
    const step1 = await metaApiCall(`${META_GRAPH_API}/${actId}/campaigns`, accessToken, {
      name: campaign.name,
      objective: mapObjectiveToMeta(campaign.objective),
      status: 'PAUSED',
      special_ad_categories: [],
      // We use ad-set-level budgets, so this must now be explicit.
      is_adset_budget_sharing_enabled: false,
    });
    if (step1.error) {
      return { success: false, error: `Campaign creation failed: ${step1.error}` };
    }
    const campaignId = step1.data.id as string;

    // Step 2: Create Ad Set (targeting + budget + schedule)
    const targeting = buildMetaTargeting(campaign);
    const { optimizationGoal, billingEvent } = getMetaAdSetConfig(campaign.objective);
    const { startTime, endTime } = normalizeMetaSchedule(campaign);

    const step2 = await metaApiCall(`${META_GRAPH_API}/${actId}/adsets`, accessToken, {
      name: `${campaign.name} - Ad Set`,
      campaign_id: campaignId,
      daily_budget: campaign.dailyBudgetCents,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      start_time: startTime,
      end_time: endTime,
      targeting,
      status: 'PAUSED',
    });
    if (step2.error) {
      return { success: false, campaignId, error: `Ad set creation failed: ${step2.error}` };
    }
    const adSetId = step2.data.id as string;

    // Step 3: Create Ad Creative (page_id is required for object_story_spec)
    const creativeSpec = await buildMetaCreativeSpec(accessToken, actId, pageId, campaign);
    if (creativeSpec.error || !creativeSpec.spec) {
      return {
        success: false,
        campaignId,
        adSetId,
        error: creativeSpec.error || 'Creative creation failed: invalid Meta creative payload',
      };
    }

    const step3 = await metaApiCall(`${META_GRAPH_API}/${actId}/adcreatives`, accessToken, {
      name: `${campaign.name} - Creative`,
      object_story_spec: creativeSpec.spec,
    });
    if (step3.error) {
      return { success: false, campaignId, adSetId, error: `Creative creation failed: ${step3.error}` };
    }
    const creativeId = step3.data.id as string;

    // Step 4: Create Ad (link creative to ad set)
    const step4 = await metaApiCall(`${META_GRAPH_API}/${actId}/ads`, accessToken, {
      name: `${campaign.name} - Ad`,
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
    });
    if (step4.error) {
      return { success: false, campaignId, adSetId, error: `Ad creation failed: ${step4.error}` };
    }

    return {
      success: true,
      campaignId,
      adSetId,
      adId: step4.data.id as string,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error creating Meta campaign',
    };
  }
}

/**
 * Update a Meta campaign status (PAUSED or ACTIVE).
 */
export async function updateMetaCampaignStatus(
  accessToken: string,
  campaignId: string,
  status: 'PAUSED' | 'ACTIVE',
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithRetry(`${META_GRAPH_API}/${campaignId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, access_token: accessToken }),
    });
    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error.message || 'Failed to update campaign status' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Fetch campaign performance insights from Meta Marketing API.
 */
export async function getMetaCampaignMetrics(
  accessToken: string,
  campaignId: string,
): Promise<{ success: boolean; metrics?: AdCampaignMetrics; error?: string }> {
  try {
    const fields = 'impressions,clicks,spend,actions,action_values,ctr,cpc,reach,frequency,video_play_actions';
    const res = await fetchWithRetry(
      `${META_GRAPH_API}/${campaignId}/insights?fields=${fields}&access_token=${accessToken}`,
    );
    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error.message || 'Failed to fetch insights' };
    }

    const row = data.data?.[0];
    if (!row) return { success: true, metrics: undefined };

    type MetaAction = { action_type: string; value: string };
    const actions = row.actions as MetaAction[] | undefined;
    const actionValues = row.action_values as MetaAction[] | undefined;

    // Conversions: offsite_conversion or purchase events
    const conversions =
      actions?.find((a) => a.action_type === 'purchase')?.value ||
      actions?.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value ||
      actions?.find((a) => a.action_type === 'offsite_conversion')?.value;

    // Conversion value: purchase revenue attributed
    const purchaseValue =
      actionValues?.find((a) => a.action_type === 'purchase')?.value ||
      actionValues?.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value;

    // Video 3-second plays
    const videoPlayActions = row.video_play_actions as MetaAction[] | undefined;
    const videoViews = Number(videoPlayActions?.[0]?.value) || 0;

    const spend = Math.round(Number(row.spend) * 100);
    const conversionValue = Math.round(Number(purchaseValue || 0) * 100);

    return {
      success: true,
      metrics: {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend,
        conversions: Number(conversions) || 0,
        ctr: Number(row.ctr) || 0,
        cpc: Math.round(Number(row.cpc) * 100),
        roas: spend > 0 ? conversionValue / spend : 0,
        conversionValue,
        reach: Number(row.reach) || 0,
        frequency: Number(row.frequency) || 0,
        videoViews,
        videoWatchTime: 0,
        lastSyncedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Fetch engagement stats for a published organic Facebook/Instagram post.
 * Returns likes, comments, shares, reach, and impressions.
 */
export async function getMetaPostEngagement(
  accessToken: string,
  postId: string,
): Promise<{ likes: number; comments: number; shares: number; reach: number; impressions: number } | null> {
  try {
    const fields = 'likes.limit(1).summary(true),comments.limit(1).summary(true),shares,insights.metric(post_impressions,post_reach)';
    const res = await fetchWithRetry(
      `${META_GRAPH_API}/${postId}?fields=${fields}&access_token=${accessToken}`,
    );
    const data = await res.json();
    if (data.error) return null;

    const insightValues: Record<string, number> = {};
    for (const item of (data.insights?.data as Array<{ name: string; values: Array<{ value: number }> }>) || []) {
      insightValues[item.name] = item.values?.[0]?.value || 0;
    }

    return {
      likes: data.likes?.summary?.total_count || 0,
      comments: data.comments?.summary?.total_count || 0,
      shares: data.shares?.count || 0,
      reach: insightValues['post_reach'] || 0,
      impressions: insightValues['post_impressions'] || 0,
    };
  } catch {
    return null;
  }
}

/**
 * List all active/paused campaigns for a Meta ad account.
 */
export async function listMetaCampaigns(
  accessToken: string,
  adAccountId: string,
): Promise<{ success: boolean; campaigns?: PlatformCampaignSummary[]; error?: string }> {
  try {
    const fields = 'id,name,status,objective,daily_budget,start_time,stop_time';
    // Meta ad account IDs may or may not have the act_ prefix
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const url = `${META_GRAPH_API}/${accountId}/campaigns?fields=${fields}&limit=500&access_token=${accessToken}`;

    const res = await fetchWithRetry(url);
    const data = await res.json() as {
      data?: Array<{
        id: string;
        name: string;
        status: string;
        objective: string;
        daily_budget?: string;
        start_time?: string;
        stop_time?: string;
      }>;
      error?: { message: string };
      paging?: { next?: string };
    };

    if (data.error) return { success: false, error: data.error.message };

    const objectiveMap: Record<string, string> = {
      OUTCOME_AWARENESS: 'awareness',
      OUTCOME_TRAFFIC: 'traffic',
      OUTCOME_ENGAGEMENT: 'engagement',
      OUTCOME_LEADS: 'leads',
      OUTCOME_SALES: 'conversions',
      OUTCOME_APP_PROMOTION: 'app_installs',
      // Legacy objectives
      BRAND_AWARENESS: 'awareness',
      REACH: 'awareness',
      LINK_CLICKS: 'traffic',
      PAGE_LIKES: 'engagement',
      POST_ENGAGEMENT: 'engagement',
      VIDEO_VIEWS: 'engagement',
      LEAD_GENERATION: 'leads',
      CONVERSIONS: 'conversions',
      APP_INSTALLS: 'app_installs',
    };

    const statusMap: Record<string, 'active' | 'paused' | 'completed'> = {
      ACTIVE: 'active',
      PAUSED: 'paused',
      ARCHIVED: 'completed',
    };

    const campaigns: PlatformCampaignSummary[] = (data.data || [])
      .filter((c) => c.status !== 'DELETED')
      .map((c) => ({
        externalCampaignId: c.id,
        name: c.name,
        status: statusMap[c.status] || 'paused',
        objective: objectiveMap[c.objective] || 'traffic',
        dailyBudgetCents: c.daily_budget ? Math.round(Number(c.daily_budget)) : 0,
        startDate: c.start_time ? c.start_time.split('T')[0] : undefined,
        endDate: c.stop_time ? c.stop_time.split('T')[0] : undefined,
      }));

    return { success: true, campaigns };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
