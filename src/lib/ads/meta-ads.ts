import type { AdCampaignDoc, AdPlatformResult } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

const META_GRAPH_API = 'https://graph.facebook.com/v21.0';

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
    return { data, error: data.error.message || 'Unknown Meta API error' };
  }
  return { data };
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
    // Step 1: Create Campaign (PAUSED)
    const step1 = await metaApiCall(`${META_GRAPH_API}/${actId}/campaigns`, accessToken, {
      name: campaign.name,
      objective: mapObjectiveToMeta(campaign.objective),
      status: 'PAUSED',
      special_ad_categories: [],
    });
    if (step1.error) {
      return { success: false, error: `Campaign creation failed: ${step1.error}` };
    }
    const campaignId = step1.data.id as string;

    // Step 2: Create Ad Set (targeting + budget + schedule)
    const targeting: Record<string, unknown> = {};
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
      if (t.interests?.length > 0) {
        targeting.flexible_spec = [{
          interests: t.interests.map((i) => ({ name: i })),
        }];
      }
    }
    if (!targeting.geo_locations) {
      targeting.geo_locations = { countries: ['US'] };
    }

    const step2 = await metaApiCall(`${META_GRAPH_API}/${actId}/adsets`, accessToken, {
      name: `${campaign.name} - Ad Set`,
      campaign_id: campaignId,
      daily_budget: campaign.dailyBudgetCents,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'REACH',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      start_time: campaign.startDate,
      end_time: campaign.endDate || undefined,
      targeting,
      status: 'PAUSED',
    });
    if (step2.error) {
      return { success: false, campaignId, error: `Ad set creation failed: ${step2.error}` };
    }
    const adSetId = step2.data.id as string;

    // Step 3: Create Ad Creative (page_id is required for object_story_spec)
    const step3 = await metaApiCall(`${META_GRAPH_API}/${actId}/adcreatives`, accessToken, {
      name: `${campaign.name} - Creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message: campaign.creative.primaryText,
          link: campaign.creative.linkUrl || undefined,
          name: campaign.creative.headline,
          description: campaign.creative.description || undefined,
          image_url: campaign.creative.imageUrl || undefined,
        },
      },
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
