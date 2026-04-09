import OpenAI from 'openai';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { workspaceCollection } from '@/lib/firestore-paths';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type AdSuggestion = {
  name: string;
  objective: string;
  platform: string;
  dailyBudgetCents: number;
  headline: string;
  primaryText: string;
  description: string;
  ctaType: string;
  linkUrl: string;
  targeting: {
    ageMin: number;
    ageMax: number;
    gender: string;
    locations: string[];
    interests: string[];
  };
  rationale: {
    summary: string;
    painPoints: string[];
    competitorInsights: string[];
    whyThisAd: string;
  };
};

const META_OBJECTIVE_OPTIONS = ['awareness', 'traffic', 'engagement'] as const;

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');
    const body = await req.json();
    const { productId, platform = 'meta' } = body as { productId?: string; platform?: string };

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    // ── 1. Load product data ─────────────────────────────────────────
    const productSnap = await adminDb
      .doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${productId}`)
      .get();

    if (!productSnap.exists) {
      return apiOk({ ok: false, error: 'Product not found' });
    }

    const product = productSnap.data()!;
    const productName = product.name as string;
    const productDescription = (product.description || product.tagline || '') as string;
    const productCategory = (product.category || product.industry || '') as string;
    const brandVoice = product.brandVoice as Record<string, unknown> | undefined;
    const websiteUrl = (product.website || product.url || '') as string;
    const targetAudience = (brandVoice?.targetAudience as string) || (product.targetAudience as string) || '';

    const client = getClient();

    // ── 2. Research: product + competitors + user pain points ────────
    const researchQuery = [
      `Product: "${productName}"`,
      productDescription ? `Description: ${productDescription}` : '',
      productCategory ? `Category: ${productCategory}` : '',
      targetAudience ? `Target audience: ${targetAudience}` : '',
      websiteUrl ? `Website: ${websiteUrl}` : '',
    ].filter(Boolean).join('\n');

    const researchPrompt = `Research this product and its market:

${researchQuery}

I need you to:
1. Identify the top 2-3 direct competitors and their main marketing angles
2. List the top 5 real user pain points this product category solves (based on reviews, forums, Reddit, etc.)
3. Identify what makes high-converting ${platform === 'tiktok' ? 'TikTok' : 'Facebook/Instagram'} ads in this space
4. Suggest the best target audience demographics (age, interests, locations)

Be specific and actionable. Use real data where possible.`;

    let researchText = '';

    // Use Responses API with web search for live research
    try {
      const researchResponse = await client.responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' as const }],
        instructions: 'You are an expert performance marketer and competitive intelligence analyst. Research thoroughly and provide actionable, specific insights.',
        input: researchPrompt,
      });

      researchText = researchResponse.output_text || '';
    } catch {
      // Fall back to knowledge-based research if web search unavailable
      const fallback = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert performance marketer and competitive intelligence analyst with deep knowledge of digital advertising. Provide specific, actionable insights based on your training data.',
          },
          { role: 'user', content: researchPrompt },
        ],
        max_tokens: 1500,
      });
      researchText = fallback.choices[0]?.message?.content || '';
    }

    // ── 3. Generate complete ad suggestion ───────────────────────────
    const platformConstraints = platform === 'tiktok'
      ? `TikTok Ads: headline max 100 chars, primaryText max 100 chars, video-first creative`
      : `Meta (Facebook/Instagram): headline max 40 chars, primaryText max 125 chars, description max 30 chars`;

    const brandVoiceBlock = brandVoice ? `
Brand Voice:
- Tone: ${brandVoice.tone || 'professional'}
- Style: ${brandVoice.style || ''}
- Keywords to use: ${(brandVoice.keywords as string[] || []).join(', ')}
- Words to avoid: ${(brandVoice.avoidWords as string[] || []).join(', ')}
- Preferred CTA: ${brandVoice.cta || ''}
- Sample voice: ${brandVoice.sampleVoice || ''}` : '';

    const generationPrompt = `Based on this market research:

${researchText}

---

Create a complete, high-converting ${platform === 'tiktok' ? 'TikTok' : 'Meta Facebook/Instagram'} ad for:
Product: ${productName}
${productDescription ? `Description: ${productDescription}` : ''}
${brandVoiceBlock}

Platform constraints: ${platformConstraints}

Return a single JSON object with exactly these fields:
{
  "name": "campaign name (descriptive, includes product + objective)",
  "objective": "one of: ${platform === 'meta' ? META_OBJECTIVE_OPTIONS.join('|') : 'awareness|traffic|engagement|leads|conversions|app_installs'}",
  "dailyBudgetCents": number (in cents, recommended starting budget for the objective),
  "headline": "attention-grabbing headline (within character limits)",
  "primaryText": "main ad body copy that speaks to the pain point (within limits)",
  "description": "supporting description (within limits)",
  "ctaType": "one of: LEARN_MORE|SHOP_NOW|SIGN_UP|DOWNLOAD|GET_QUOTE|CONTACT_US",
  "linkUrl": "",
  "targeting": {
    "ageMin": number,
    "ageMax": number,
    "gender": "all|male|female",
    "locations": ["US"],
    "interests": ["3-5 specific interest keywords"]
  },
  "rationale": {
    "summary": "1-2 sentence explanation of the strategy",
    "painPoints": ["top 3 pain points this ad addresses"],
    "competitorInsights": ["2-3 key differentiators vs competitors"],
    "whyThisAd": "why this specific angle will convert"
  }
}

Make the ad speak directly to the biggest pain point. Be specific and compelling. Focus on the transformation/outcome, not features.`;

    const genResponse = await client.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a world-class performance marketer who has created ads generating millions in revenue. You write highly specific, emotionally resonant ad copy that converts. Always return valid JSON.',
        },
        { role: 'user', content: generationPrompt },
      ],
      max_tokens: 1200,
    });

    const rawJson = genResponse.choices[0]?.message?.content || '{}';
    const suggestion = JSON.parse(rawJson) as AdSuggestion;

    // Normalize platform
    suggestion.platform = platform;
    if (platform === 'meta' && !META_OBJECTIVE_OPTIONS.includes(suggestion.objective as typeof META_OBJECTIVE_OPTIONS[number])) {
      suggestion.objective = 'traffic';
    }

    // Ensure linkUrl uses product website if available
    if (!suggestion.linkUrl && websiteUrl) {
      suggestion.linkUrl = websiteUrl;
    }

    return apiOk({ ok: true, suggestion, researchSummary: researchText.substring(0, 500) + '...' });
  } catch (error) {
    return apiError(error);
  }
}
