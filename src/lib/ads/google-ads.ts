import type { AdCampaignDoc, AdPlatformResult, AdCampaignMetrics } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';
import { fetchWithRetry } from '@/lib/fetch-retry';

const GOOGLE_ADS_API_VERSION = 'v23';

/**
 * Common ISO-3166 country codes → Google Ads geo target constant IDs.
 * Full list: https://developers.google.com/google-ads/api/data/geotargets
 */
const COUNTRY_CODE_TO_GEO_ID: Record<string, string> = {
  US: '2840', GB: '2826', CA: '2124', AU: '2036', DE: '2276', FR: '2250',
  IN: '2356', BR: '2076', JP: '2392', MX: '2484', ES: '2724', IT: '2380',
  NL: '2528', SE: '2752', NO: '2578', DK: '2208', FI: '2246', CH: '2756',
  AT: '2040', BE: '2056', IE: '2372', NZ: '2554', SG: '2702', HK: '2344',
  KR: '2410', TW: '2158', ZA: '2710', AE: '2784', SA: '2682', IL: '2376',
  PL: '2616', CZ: '2203', PT: '2620', AR: '2032', CL: '2152', CO: '2170',
  PH: '2608', TH: '2764', MY: '2458', ID: '2360', NG: '2566', EG: '2818',
  KE: '2404', PK: '2586', BD: '2050', VN: '2704', RO: '2642', HU: '2348',
  GR: '2300', TR: '2792', UA: '2804', RU: '2643', PE: '2604',
};

/** Resolve a location string (country code or numeric ID) to a geo target constant resource path. */
function resolveGeoTargetId(location: string): string | null {
  const trimmed = location.trim().toUpperCase();
  // Already a numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;
  // Known country code
  const geoId = COUNTRY_CODE_TO_GEO_ID[trimmed];
  return geoId || null;
}

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

  if (creative.additionalHeadlines?.length) {
    for (const h of creative.additionalHeadlines) {
      headlines.push({ text: h.substring(0, 30) });
    }
  }

  if (headlines.length < 3 && creative.description) {
    headlines.push({ text: creative.description.substring(0, 30) });
  }

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

  if (creative.additionalDescriptions?.length) {
    for (const d of creative.additionalDescriptions) {
      descriptions.push({ text: d.substring(0, 90) });
    }
  }

  if (creative.description && descriptions.length < 2) {
    descriptions.push({ text: creative.description.substring(0, 90) });
  }

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
 * Build a Responsive Display Ad payload for DISPLAY campaigns.
 * Requires at least one marketing image and one headline/description.
 */
function buildResponsiveDisplayAd(
  creative: AdCampaignDoc['creative'],
): Record<string, unknown> {
  const headlines = buildHeadlines(creative).map((h) => ({ text: h.text }));
  const descriptions = buildDescriptions(creative).map((d) => ({ text: d.text }));

  const ad: Record<string, unknown> = {
    responsiveDisplayAd: {
      headlines,
      descriptions,
      longHeadline: { text: creative.headline.substring(0, 90) },
      businessName: creative.headline.substring(0, 25),
      ...(creative.imageUrl ? { marketingImages: [{ asset: creative.imageUrl }] } : {}),
    },
    finalUrls: creative.linkUrl ? [creative.linkUrl] : [],
  };
  return ad;
}

/**
 * Create a campaign on Google Ads REST API.
 * Steps: Budget → Campaign → Geo Targeting → Ad Group → Keywords → Ad → Enable
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

    // Step 2: Create Campaign (initially PAUSED, enabled at the end)
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

    // Step 3: Add geo targeting criteria (location targeting)
    const locations = campaign.targeting?.locations;
    if (locations?.length) {
      const resolvedIds = locations
        .map((loc) => resolveGeoTargetId(loc))
        .filter((id): id is string => id !== null);

      if (resolvedIds.length > 0) {
        const geoOps = resolvedIds.map((geoId) => ({
          create: {
            campaign: campaignResourceName,
            location: {
              geoTargetConstant: `geoTargetConstants/${geoId}`,
            },
            negative: false,
          },
        }));
        const geoRes = await fetchWithRetry(`${baseUrl}/campaignCriteria:mutate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ operations: geoOps }),
        });
        const geoData = await geoRes.json();
        const geoError = parseGoogleError(geoData);
        if (geoError) {
          console.warn(`Geo targeting warning: ${geoError}`);
        }
      }
    }

    // Step 4: Create Ad Group
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

    // Step 5: Add keywords to the ad group (search campaigns only)
    const keywords = campaign.targeting?.keywords;
    if (campaignType === 'SEARCH' && keywords?.length) {
      const kwOps = keywords.map((kw) => ({
        create: {
          adGroup: adGroupResourceName,
          keyword: {
            text: kw,
            matchType: 'BROAD',
          },
          status: 'ENABLED',
        },
      }));
      const kwRes = await fetchWithRetry(`${baseUrl}/adGroupCriteria:mutate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operations: kwOps }),
      });
      const kwData = await kwRes.json();
      const kwError = parseGoogleError(kwData);
      if (kwError) {
        console.warn(`Keyword creation warning: ${kwError}`);
      }
    }

    // Step 6: Create Ad (RSA for search, Responsive Display Ad for display)
    const isSearch = campaignType === 'SEARCH';
    const adPayload = isSearch
      ? {
        ad: {
          responsiveSearchAd: {
            headlines: buildHeadlines(campaign.creative),
            descriptions: buildDescriptions(campaign.creative),
          },
          finalUrls: campaign.creative.linkUrl ? [campaign.creative.linkUrl] : [],
        },
      }
      : {
        ad: buildResponsiveDisplayAd(campaign.creative),
      };

    const adRes = await fetchWithRetry(`${baseUrl}/adGroupAds:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          create: {
            adGroup: adGroupResourceName,
            status: 'ENABLED',
            ...adPayload,
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

    // Step 7: Enable the campaign (all sub-objects are ready)
    const enableRes = await fetchWithRetry(`${baseUrl}/campaigns:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: { resourceName: campaignResourceName, status: 'ENABLED' },
          updateMask: 'status',
        }],
      }),
    });
    const enableData = await enableRes.json();
    const enableError = parseGoogleError(enableData);
    if (enableError) {
      // Campaign was created but couldn't be enabled — return success with warning
      return { success: true, campaignId, adSetId, adId, error: `Campaign created but activation failed: ${enableError}` };
    }

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
      metrics.conversions_value,
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

    const spend = Math.round(Number(row.costMicros) / 10000);
    const conversionValue = Math.round(Number(row.conversionsValue || 0) * 100);
    return {
      success: true,
      metrics: {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        spend,
        conversions: Math.round(Number(row.conversions) || 0),
        ctr: Number(row.ctr) || 0,
        cpc: Math.round(Number(row.averageCpc) / 10000),
        roas: spend > 0 ? conversionValue / spend : 0,
        conversionValue,
        reach: 0,        // Google campaign-level GAQL does not expose reach
        frequency: 0,
        videoViews: 0,
        videoWatchTime: 0,
        lastSyncedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Update an existing Google Ads campaign budget.
 * Finds the budget resource linked to the campaign, then updates amountMicros.
 */
export async function updateGoogleCampaignBudget(
  accessToken: string,
  customerId: string,
  developerToken: string,
  campaignId: string,
  dailyBudgetCents: number,
  loginCustomerId?: string,
): Promise<{ success: boolean; error?: string }> {
  const cleanCustomerId = customerId.replace(/-/g, '');
  const baseUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}`;
  const headers = buildHeaders(accessToken, developerToken, loginCustomerId);

  try {
    // Look up the budget resource name from the campaign
    const query = `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId}`;
    const lookupRes = await fetchWithRetry(`${baseUrl}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    const lookupData = await lookupRes.json();
    const lookupError = parseGoogleError(lookupData);
    if (lookupError) return { success: false, error: `Budget lookup failed: ${lookupError}` };

    const budgetResourceName = lookupData?.[0]?.results?.[0]?.campaign?.campaignBudget;
    if (!budgetResourceName) return { success: false, error: 'Campaign budget not found' };

    // Update the budget amount
    const res = await fetchWithRetry(`${baseUrl}/campaignBudgets:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName: budgetResourceName,
            amountMicros: (dailyBudgetCents * 10000).toString(),
          },
          updateMask: 'amountMicros',
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
