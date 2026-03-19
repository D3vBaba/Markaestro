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
        content: `You are a TikTok trend analyst and cinematic video director. You deeply understand what makes TikTok videos go viral — the hooks, formats, sounds, and psychological triggers that drive views, saves, and shares.

Your job is to identify CURRENT viral TikTok trends and adapt them specifically for promoting a given product. For each trend, you write a CINEMATIC VIDEO PROMPT that an AI video model (Kling 2.6) can execute.

CRITICAL — Your videoPromptSuggestion must be:
- A vivid, cinematic scene description — describe EXACTLY what the camera sees
- Physically concrete: lighting, colors, textures, materials, environment, weather, time of day
- Camera-directed: specify camera movement (slow dolly, tracking shot, crane up, push in, orbiting)
- Paced for 10 seconds: describe what happens at the start, middle, and end of the shot
- Visually rich: think like a cinematographer — shallow depth of field, golden hour light, neon reflections, rain on glass, steam rising, fabric flowing
- NO abstract concepts — the AI model cannot understand "innovation" or "empowerment", it needs "a glowing smartphone on a marble desk with morning sunlight streaming through floor-to-ceiling windows"
- NO people/faces — AI video models struggle with realistic humans. Use objects, environments, products, abstract scenes, nature, architecture, or stylized/silhouette figures instead
- NO text overlays or UI — just pure visual storytelling

Focus on trends that:
- Can be executed with AI-generated video (no real people required)
- Work for product marketing without feeling overly promotional
- Have high virality potential (shareable, relatable, or curiosity-driven)
- Feature satisfying visuals: transformations, reveals, mesmerizing motion, dramatic lighting shifts

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
8. A CINEMATIC video generation prompt (videoPromptSuggestion) — this is the most important field. Write it as a rich, visual scene description for a 10-second vertical video. Example of a GOOD prompt:

"Slow cinematic dolly forward through a dimly lit workspace at golden hour. Warm amber light spills through venetian blinds casting striped shadows across a sleek laptop screen glowing with colorful data dashboards. Camera pushes in slowly as steam rises from a ceramic coffee mug beside the keyboard. Shallow depth of field, the background softly blurred with bokeh from city lights through the window. The light gradually shifts from warm amber to cool blue as the camera reaches the screen, creating a dramatic color transition. Dust particles float through the light beams. The scene feels aspirational, calm, and intentional — a quiet moment of productivity."

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
      "videoPromptSuggestion": "A cinematic, visually rich scene description with specific lighting, camera movement, colors, textures, and pacing for a 10-second vertical video..."
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
