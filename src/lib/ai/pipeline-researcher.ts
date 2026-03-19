import OpenAI from 'openai';
import type { BrandVoice, ResearchBrief } from '@/lib/schemas';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ResearchInput = {
  productName: string;
  productDescription: string;
  productUrl?: string;
  productCategories: string[];
  brandVoice?: BrandVoice;
};

async function researchCompetitors(client: OpenAI, input: ResearchInput) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a competitive intelligence analyst specializing in digital marketing. Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Analyze the competitive landscape for "${input.productName}" in the ${input.productCategories.join(', ')} space.
${input.productDescription ? `Product description: ${input.productDescription}` : ''}
${input.productUrl ? `Product website: ${input.productUrl}` : ''}
${input.brandVoice?.targetAudience ? `Target audience: ${input.brandVoice.targetAudience}` : ''}

Identify 3-5 direct or close competitors. For each competitor, analyze how they market on social media — what messaging works, what angles they use, and where they fall short.

Return JSON in this exact format:
{
  "competitors": [
    {
      "name": "Competitor name",
      "positioning": "How they position themselves in 1-2 sentences",
      "strengths": "What they do well in marketing/social media presence",
      "weaknesses": "Where their marketing falls short or gaps we can exploit"
    }
  ]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  return parsed.competitors || [];
}

async function researchTrends(client: OpenAI, input: ResearchInput) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a social media strategist who tracks what content formats and messaging strategies drive engagement. Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `For products in the ${input.productCategories.join(', ')} space targeting ${input.brandVoice?.targetAudience || 'general audiences'}, identify 5-7 current social media marketing trends and content strategies that are driving engagement.

Product context: "${input.productName}" — ${input.productDescription || 'a product in this space'}

For each trend, explain how it could specifically be applied to promote this product on social media (X, Facebook, Instagram, TikTok).

Return JSON in this exact format:
{
  "trends": [
    {
      "trend": "Name or description of the trend",
      "relevance": "Why this trend matters for this product category",
      "contentAngle": "Specific way to apply this trend to promote ${input.productName}"
    }
  ]
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  return parsed.trends || [];
}

async function analyzeProduct(client: OpenAI, input: ResearchInput) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a brand strategist who extracts actionable messaging insights from product information. Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Analyze this product and extract key messaging insights for a social media adoption campaign:

Product: "${input.productName}"
Description: ${input.productDescription || 'Not provided'}
Website: ${input.productUrl || 'Not provided'}
Categories: ${input.productCategories.join(', ')}
Target audience: ${input.brandVoice?.targetAudience || 'Not specified'}
${input.brandVoice?.tone ? `Brand tone: ${input.brandVoice.tone}` : ''}
${input.brandVoice?.style ? `Brand style: ${input.brandVoice.style}` : ''}

Extract:
1. 3-5 key messages that should be woven throughout the campaign
2. The unique value proposition in one sentence
3. 3-5 specific pain points the target audience has that this product solves
4. Tone and voice recommendations for social media content

Return JSON in this exact format:
{
  "productInsights": {
    "keyMessages": ["message 1", "message 2", "..."],
    "uniqueValueProp": "One sentence UVP",
    "audiencePainPoints": ["pain point 1", "pain point 2", "..."],
    "toneRecommendations": "Detailed tone/voice guidance for content creation"
  }
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  return parsed.productInsights || {
    keyMessages: [],
    uniqueValueProp: '',
    audiencePainPoints: [],
    toneRecommendations: '',
  };
}

export async function researchForPipeline(input: ResearchInput): Promise<ResearchBrief> {
  const client = getClient();

  const [competitors, trends, productInsights] = await Promise.all([
    researchCompetitors(client, input),
    researchTrends(client, input),
    analyzeProduct(client, input),
  ]);

  return {
    competitors,
    trends,
    productInsights,
    generatedAt: new Date().toISOString(),
  };
}
