import type { AdCampaignDoc, AdPlatformResult } from './types';
import type { AdCampaignObjective } from '@/lib/schemas';

const GOOGLE_ADS_API_VERSION = 'v17';

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
 * Pads with generated variations if the user only provides 1.
 */
function buildHeadlines(creative: AdCampaignDoc['creative']): Array<{ text: string; pinnedField?: string }> {
  const headlines: Array<{ text: string; pinnedField?: string }> = [
    { text: creative.headline.substring(0, 30), pinnedField: 'HEADLINE_1' },
  ];
  // Generate variations to meet the minimum of 3
  if (creative.description) {
    headlines.push({ text: creative.description.substring(0, 30) });
  }
  // Ensure we have at least 3
  const fallbacks = [
    `Learn More Today`,
    `Get Started Now`,
    `See How It Works`,
  ];
  for (const fb of fallbacks) {
    if (headlines.length >= 3) break;
    headlines.push({ text: fb });
  }
  return headlines;
}

/**
 * Build RSA descriptions (minimum 2 required, max 90 chars each).
 */
function buildDescriptions(creative: AdCampaignDoc['creative']): Array<{ text: string }> {
  const descriptions: Array<{ text: string }> = [
    { text: creative.primaryText.substring(0, 90) },
  ];
  if (creative.description) {
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
  // Strip hyphens from customer IDs (Google Ads API requires plain numbers)
  const cleanCustomerId = customerId.replace(/-/g, '');
  const baseUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  // MCC accounts require login-customer-id header
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
  }

  try {
    // Step 1: Create Campaign Budget
    const budgetRes = await fetch(`${baseUrl}/campaignBudgets:mutate`, {
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
    const campaignRes = await fetch(`${baseUrl}/campaigns:mutate`, {
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
    const adGroupRes = await fetch(`${baseUrl}/adGroups:mutate`, {
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
    const adRes = await fetch(`${baseUrl}/adGroupAds:mutate`, {
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

    return {
      success: true,
      campaignId,
      adSetId,
      adId,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error creating Google campaign',
    };
  }
}
