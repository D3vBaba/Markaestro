import type { AdCampaignDoc, AdPlatformResult, AdCampaignMetrics } from './types';
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
  const imageUrl = campaign.creative.imageUrl?.trim();
  const videoUrl = campaign.creative.videoUrl?.trim();

  if (imageUrl && videoUrl) {
    return {
      error: 'Meta ads currently support a single creative asset per ad. Remove either the image or the video and try again.',
    };
  }

  if (videoUrl) {
    return {
      error: 'Meta video creatives are not configured yet. Use an image creative for now.',
    };
  }

  const imageAsset = imageUrl
    ? await resolveMetaImageAsset(accessToken, actId, imageUrl)
    : {};

  const callToAction = campaign.creative.ctaType
    ? {
      type: campaign.creative.ctaType,
      value: {
        link: campaign.creative.linkUrl,
      },
    }
    : undefined;

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
    const fields = 'impressions,clicks,spend,actions,ctr,cpc';
    const res = await fetchWithRetry(
      `${META_GRAPH_API}/${campaignId}/insights?fields=${fields}&access_token=${accessToken}`,
    );
    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error.message || 'Failed to fetch insights' };
    }

    const row = data.data?.[0];
    if (!row) return { success: true, metrics: undefined };

    const conversions = (row.actions as Array<{ action_type: string; value: string }> | undefined)
      ?.find((a) => a.action_type === 'offsite_conversion')?.value;

    return {
      success: true,
      metrics: {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend: Math.round(Number(row.spend) * 100),
        conversions: Number(conversions) || 0,
        ctr: Number(row.ctr) || 0,
        cpc: Math.round(Number(row.cpc) * 100),
        lastSyncedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
