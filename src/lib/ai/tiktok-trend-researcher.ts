import OpenAI from 'openai';
import type { BrandVoice } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type TrendResearchInput = {
  productName: string;
  productDescription: string;
  productCategories: string[];
  brandVoice?: BrandVoice;
  /** Optional focus area like "tutorials", "humor", "transformations" */
  focusArea?: string;
};

export type TikTokTrendResult = {
  name: string;
  description: string;
  format: string;
  hooks: string[];
  hashtags: string[];
  viralityScore: number;
  relevanceScore: number;
  videoPromptSuggestion: string;
};

export type TrendResearchOutput = {
  trends: TikTokTrendResult[];
  researchedAt: string;
};

/**
 * Research viral TikTok trends relevant to a product and return actionable
 * trend briefs with video prompt suggestions.
 */
export async function researchTikTokTrends(input: TrendResearchInput): Promise<TrendResearchOutput> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a TikTok trend analyst and viral content strategist. You deeply understand what makes TikTok videos go viral — the hooks, formats, sounds, and psychological triggers that drive views, saves, and shares.

Your job is to identify CURRENT viral TikTok trends and adapt them specifically for promoting a given product. You don't just list trends — you explain exactly how to execute them and provide a concrete video generation prompt for each.

Focus on trends that:
- Can be executed with AI-generated video (no real people required)
- Work for product marketing without feeling overly promotional
- Have high virality potential (shareable, relatable, or curiosity-driven)
- Feel native to TikTok (not repurposed Instagram or YouTube content)

Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Research 5-7 viral TikTok trends that could be used to promote this product:

Product: "${input.productName}"
Description: ${input.productDescription || 'Not provided'}
Categories: ${input.productCategories.join(', ')}
Target audience: ${input.brandVoice?.targetAudience || 'General audience'}
Brand tone: ${input.brandVoice?.tone || 'Not specified'}
${input.focusArea ? `Focus area: ${input.focusArea}` : ''}

For each trend, provide:
1. A catchy trend name
2. Description of the trend and why it's viral
3. The specific video format (e.g., "POV transformation", "before/after split screen", "satisfying process reveal")
4. 2-3 hook variations — the opening 1-2 seconds that stop the scroll
5. Relevant hashtags (mix of trend-specific and niche)
6. Virality score (0-100) — how likely this format is to get views
7. Relevance score (0-100) — how well this fits the product
8. A detailed video generation prompt that an AI video model could use to create the video (describe scenes, transitions, visual style, pacing — optimized for 9:16 vertical video, 5-10 seconds)

Return JSON in this exact format:
{
  "trends": [
    {
      "name": "Trend name",
      "description": "Why this trend is viral and how it works",
      "format": "Specific video format description",
      "hooks": ["Hook variation 1", "Hook variation 2"],
      "hashtags": ["#hashtag1", "#hashtag2"],
      "viralityScore": 85,
      "relevanceScore": 75,
      "videoPromptSuggestion": "Detailed scene-by-scene video prompt for AI generation..."
    }
  ]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);

  return {
    trends: parsed.trends || [],
    researchedAt: new Date().toISOString(),
  };
}
