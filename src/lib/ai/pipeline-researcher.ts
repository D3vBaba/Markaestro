import OpenAI from 'openai';
import type { BrandVoice, ResearchBrief } from '@/lib/schemas';
import { serper, formatResultsForLLM } from './serper-client';
import { getResearchCache, setResearchCache } from './research-cache';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

export type ResearchInput = {
  productId?: string;
  productName: string;
  productDescription: string;
  productUrl?: string;
  productCategories: string[];
  brandVoice?: BrandVoice;
};

// ── Serper search queries ─────────────────────────────────────────────────────

async function fetchCompetitorSearchData(input: ResearchInput) {
  const category = input.productCategories.join(', ');
  const audience = input.brandVoice?.targetAudience || '';

  const [brandResults, directResults] = await Promise.all([
    serper.search(
      `${category} brand social media marketing strategy 2025${audience ? ` for ${audience}` : ''}`,
      'search',
      5,
    ),
    serper.search(
      `${input.productName} competitors alternatives`,
      'search',
      5,
    ),
  ]);

  return { brandResults, directResults };
}

async function fetchTrendSearchData(input: ResearchInput) {
  const category = input.productCategories.join(', ');
  const audience = input.brandVoice?.targetAudience || 'professionals';

  const [trendResults, viralResults] = await Promise.all([
    serper.search(
      `${category} ${audience} trending topics social media 2025`,
      'news',
      5,
    ),
    serper.search(
      `best ${category} Instagram TikTok content ideas viral 2025`,
      'search',
      5,
    ),
  ]);

  return { trendResults, viralResults };
}

// ── GPT-4o-mini synthesis ─────────────────────────────────────────────────────

async function synthesizeCompetitors(
  client: OpenAI,
  input: ResearchInput,
  brandData: string,
  directData: string,
) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a competitive intelligence analyst. Extract competitor insights from real search results. Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Analyze the competitive landscape for "${input.productName}" (${input.productCategories.join(', ')}) using these real search results.

SEARCH RESULTS — industry marketing patterns:
${brandData}

SEARCH RESULTS — direct competitors:
${directData}

Based on these results, identify 3-5 competitors and their social media marketing approaches.

Return JSON:
{
  "competitors": [
    {
      "name": "Competitor name",
      "positioning": "How they position themselves in 1-2 sentences",
      "strengths": "What they do well in marketing/social media",
      "weaknesses": "Where their marketing falls short or gaps to exploit"
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

async function synthesizeTrends(
  client: OpenAI,
  input: ResearchInput,
  trendData: string,
  viralData: string,
  newsSources: string[],
) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a social media strategist. Extract actionable trends from real search and news results. Return valid JSON only.`,
      },
      {
        role: 'user',
        content: `Identify trending content strategies for "${input.productName}" (${input.productCategories.join(', ')}) using these real search results.

RECENT NEWS & TRENDING TOPICS:
${trendData}

VIRAL CONTENT PATTERNS:
${viralData}

Target audience: ${input.brandVoice?.targetAudience || 'general audiences'}

Extract 5-7 specific trends and content angles directly supported by these results. For each, explain how to apply it to promote ${input.productName}.

Return JSON:
{
  "trends": [
    {
      "trend": "Specific trend name or pattern",
      "relevance": "Why this trend matters for this product category right now",
      "contentAngle": "Concrete way to apply this trend to promote ${input.productName}"
    }
  ],
  "newsHookHeadlines": ["headline 1", "headline 2", "headline 3"],
  "sources": ${JSON.stringify(newsSources.slice(0, 5))}
}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  return {
    trends: parsed.trends || [],
    newsHookHeadlines: parsed.newsHookHeadlines || [],
    sources: parsed.sources || [],
  };
}

async function synthesizeProductInsights(client: OpenAI, input: ResearchInput) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a brand strategist who extracts actionable messaging insights. Return valid JSON only.`,
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

Return JSON:
{
  "productInsights": {
    "keyMessages": ["message 1", "message 2"],
    "uniqueValueProp": "One sentence UVP",
    "audiencePainPoints": ["pain point 1", "pain point 2"],
    "toneRecommendations": "Detailed tone/voice guidance"
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

// ── Main export ───────────────────────────────────────────────────────────────

export async function researchForPipeline(input: ResearchInput): Promise<ResearchBrief> {
  // Check cache first (keyed by productId + today's date)
  if (input.productId) {
    const cached = await getResearchCache(input.productId);
    if (cached) return cached;
  }

  const client = getClient();

  // Run all 4 Serper searches + product analysis in parallel
  const [competitorSearchData, trendSearchData, productInsights] = await Promise.all([
    fetchCompetitorSearchData(input),
    fetchTrendSearchData(input),
    synthesizeProductInsights(client, input),
  ]);

  // Collect source URLs from news results for attribution
  const newsSources = trendSearchData.trendResults.results.map((r) => r.link);

  // Synthesize competitors and trends from real search data (parallel)
  const [competitors, trendOutput] = await Promise.all([
    synthesizeCompetitors(
      client,
      input,
      formatResultsForLLM(
        competitorSearchData.brandResults.results,
        competitorSearchData.brandResults.answerBox,
      ),
      formatResultsForLLM(
        competitorSearchData.directResults.results,
        competitorSearchData.directResults.answerBox,
      ),
    ),
    synthesizeTrends(
      client,
      input,
      formatResultsForLLM(
        trendSearchData.trendResults.results,
        trendSearchData.trendResults.answerBox,
      ),
      formatResultsForLLM(
        trendSearchData.viralResults.results,
        trendSearchData.viralResults.answerBox,
      ),
      newsSources,
    ),
  ]);

  const result: ResearchBrief = {
    competitors,
    trends: trendOutput.trends,
    productInsights,
    newsHookHeadlines: trendOutput.newsHookHeadlines,
    sources: trendOutput.sources,
    generatedAt: new Date().toISOString(),
  };

  // Write to cache async — don't block the response
  if (input.productId) {
    setResearchCache(input.productId, result).catch(() => {});
  }

  return result;
}
