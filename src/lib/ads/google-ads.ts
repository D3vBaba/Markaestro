import type { AdCampaignDoc, AdPlatformResult, AdCampaignMetrics } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

const GOOGLE_ADS_API_VERSION = 'v23';

/**
 * Map generic objectives to Google Ads campaign types.
 */
function mapObjectiveToGoogle(objective: AdCampaignObjective): string {
  const map: Record<AdCampaignObjective, string> = {
    awareness: 'DISPLAY',
    traffic: 'SEARCH',
    engagement: 'DISPLAY',
    leads: 'SEARCH',
    conversions: 'SEARCH',
    app_installs: 'MULTI_CHANNEL',
  };
  return map[objective] || 'SEARCH';
}

/**
 * Build RSA headlines (minimum 3 required, max 30 chars each).
 * Uses additionalHeadlines from creative if available.
 */
function buildHeadlines(creative: AdCampaignDoc['creative']): Array<{ text: string; pinnedField?: string }> {
  const headlines: Array<{ text: string; pinnedField?: string }> = [
    { text: creative.headline.substring(0, 30), pinnedField: 'HEADLINE_1' },
  ];

  // Use additional headlines from creative if provided
  if (creative.additionalHeadlines?.length) {
    for (const h of creative.additionalHeadlines) {
      headlines.push({ text: h.substring(0, 30) });
    }
  }

  // Fall back to description if we still need more
  if (headlines.length < 3 && creative.description) {
    headlines.push({ text: creative.description.substring(0, 30) });
  }

  // Ensure we have at least 3
  const fallbacks = ['Learn More Today', 'Get Started Now', 'See How It Works'];
  for (const fb of fallbacks) {
    if (headlines.length >= 3) break;
    headlines.push({ text: fb });
  }
  return headlines;
}

/**
 * Build RSA descriptions (minimum 2 required, max 90 chars each).
 * Uses additionalDescriptions from creative if available.
 */
function buildDescriptions(creative: AdCampaignDoc['creative']): Array<{ text: string }> {
  const descriptions: Array<{ text: string }> = [
    { text: creative.primaryText.substring(0, 90) },
  ];

  // Use additional descriptions from creative if provided
  if (creative.additionalDescriptions?.length) {
    for (const d of creative.additionalDescriptions) {
      descriptions.push({ text: d.substring(0, 90) });
    }
  }

  if (creative.description && descriptions.length < 2) {
    descriptions.push({ text: creative.description.substring(0, 90) });
  }

  // Ensure we have at least 2
  if (descriptions.length < 2) {
    descriptions.push({ text: creative.headline.substring(0, 90) });
  }
  return descriptions;
}

/** Helper to parse Google Ads API error details. */
function parseGoogleError(data: Record<string, unknown>): string | undefined {
  if (!data.error) return undefined;
  const err = data.error as Record<string, unknown>;
  const details = err.details as Array<Record<string, unknown>> | undefined;
  if (details?.[0]?.errors) {
    const errors = details[0].errors as Array<{ message?: string; errorCode?: Record<string, string> }>;
    return errors.map((e) => e.message || JSON.stringify(e.errorCode)).join('; ');
  }
  return (err.message as string) || 'Unknown Google Ads error';
}

/** Build standard Google Ads API headers. */
function buildHeaders(
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
  }
  return headers;
}

/**
 * Create a campaign on Google Ads REST API.
 * Steps: Budget → Campaign → Ad Group → Responsive Search Ad
 * All objects are created PAUSED so the user can review before activating.
 */
export async function createGoogleCampaign(
  accessToken: string,
  customerId: string,
  developerToken: string,
  campaign: AdCampaignDoc,
  loginCustomerId?: string,
): Promise<AdPlatformResult> {
  const cleanCustomerId = customerId.replace(/-/g, '');
  const baseUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}`;
  const headers = buildHeaders(accessToken, developerToken, loginCustomerId);

  try {
    // Step 1: Create Campaign Budget
    const budgetRes = await fetchWithRetry(`${baseUrl}/campaignBudgets:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          create: {
            name: `${campaign.name} - Budget`,
            amountMicros: (campaign.dailyBudgetCents * 10000).toString(),
            deliveryMethod: 'STANDARD',
          },
        }],
      }),
    });
    const budgetData = await budgetRes.json();
    const budgetError = parseGoogleError(budgetData);
    if (budgetError) {
      return { success: false, error: `Budget creation failed: ${budgetError}` };
    }
    const budgetResourceName = budgetData.results?.[0]?.resourceName;
    if (!budgetResourceName) {
      return { success: false, error: 'No budget resource name returned' };
    }

    // Step 2: Create Campaign
    const campaignType = mapObjectiveToGoogle(campaign.objective);
    const campaignRes = await fetchWithRetry(`${baseUrl}/campaigns:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          create: {
            name: campaign.name,
            advertisingChannelType: campaignType,
            status: 'PAUSED',
            campaignBudget: budgetResourceName,
            startDate: campaign.startDate.split('T')[0].replace(/-/g, ''),
            endDate: campaign.endDate ? campaign.endDate.split('T')[0].replace(/-/g, '') : undefined,
            manualCpc: {},
          },
        }],
      }),
    });
    const campaignData = await campaignRes.json();
    const campaignError = parseGoogleError(campaignData);
    if (campaignError) {
      return { success: false, error: `Campaign creation failed: ${campaignError}` };
    }
    const campaignResourceName = campaignData.results?.[0]?.resourceName;
    const campaignId = campaignResourceName?.split('/').pop();

    // Step 3: Create Ad Group
    const adGroupRes = await fetchWithRetry(`${baseUrl}/adGroups:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          create: {
            name: `${campaign.name} - Ad Group`,
            campaign: campaignResourceName,
            status: 'ENABLED',
            type: campaignType === 'SEARCH' ? 'SEARCH_STANDARD' : 'DISPLAY_STANDARD',
            cpcBidMicros: '1000000',
          },
        }],
      }),
    });
    const adGroupData = await adGroupRes.json();
    const adGroupError = parseGoogleError(adGroupData);
    if (adGroupError) {
      return { success: false, campaignId, error: `Ad group creation failed: ${adGroupError}` };
    }
    const adGroupResourceName = adGroupData.results?.[0]?.resourceName;
    const adSetId = adGroupResourceName?.split('/').pop();

    // Step 4: Create Responsive Search Ad (minimum 3 headlines, 2 descriptions)
    const adRes = await fetchWithRetry(`${baseUrl}/adGroupAds:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          create: {
            adGroup: adGroupResourceName,
            status: 'PAUSED',
            ad: {
              responsiveSearchAd: {
                headlines: buildHeadlines(campaign.creative),
                descriptions: buildDescriptions(campaign.creative),
              },
              finalUrls: campaign.creative.linkUrl ? [campaign.creative.linkUrl] : [],
            },
          },
        }],
      }),
    });
    const adData = await adRes.json();
    const adError = parseGoogleError(adData);
    if (adError) {
      return { success: false, campaignId, adSetId, error: `Ad creation failed: ${adError}` };
    }
    const adId = adData.results?.[0]?.resourceName?.split('/').pop();

    return { success: true, campaignId, adSetId, adId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error creating Google campaign',
    };
  }
}

/**
 * Update a Google Ads campaign status (PAUSED or ENABLED).
 */
export async function updateGoogleCampaignStatus(
  accessToken: string,
  customerId: string,
  developerToken: string,
  campaignId: string,
  status: 'PAUSED' | 'ENABLED',
  loginCustomerId?: string,
): Promise<{ success: boolean; error?: string }> {
  const cleanCustomerId = customerId.replace(/-/g, '');
  const baseUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}`;
  const headers = buildHeaders(accessToken, developerToken, loginCustomerId);
  const resourceName = `customers/${cleanCustomerId}/campaigns/${campaignId}`;

  try {
    const res = await fetchWithRetry(`${baseUrl}/campaigns:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: { resourceName, status },
          updateMask: 'status',
        }],
      }),
    });
    const data = await res.json();
    const error = parseGoogleError(data);
    if (error) return { success: false, error };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Fetch campaign performance metrics via Google Ads Query Language (GAQL).
 */
export async function getGoogleCampaignMetrics(
  accessToken: string,
  customerId: string,
  developerToken: string,
  campaignId: string,
  loginCustomerId?: string,
): Promise<{ success: boolean; metrics?: AdCampaignMetrics; error?: string }> {
  const cleanCustomerId = customerId.replace(/-/g, '');
  const baseUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}`;
  const headers = buildHeaders(accessToken, developerToken, loginCustomerId);

  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE campaign.id = ${campaignId}
  `.trim();

  try {
    const res = await fetchWithRetry(`${baseUrl}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    const error = parseGoogleError(data);
    if (error) return { success: false, error };

    const row = data?.[0]?.results?.[0]?.metrics;
    if (!row) return { success: true, metrics: undefined };

    return {
      success: true,
      metrics: {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend: Math.round(Number(row.costMicros) / 10000),
        conversions: Math.round(Number(row.conversions) || 0),
        ctr: Number(row.ctr) || 0,
        cpc: Math.round(Number(row.averageCpc) / 10000),
        lastSyncedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
