import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import type { AdCampaignDoc } from '@/lib/ads/types';
import OpenAI from 'openai';

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
}

/**
 * Generate AI-powered performance insights for a specific ad campaign.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = snap.data() as AdCampaignDoc;

    // Build context for AI analysis
    const metrics = campaign.metrics;
    const hasMetrics = metrics && metrics.impressions > 0;

    const prompt = `You are a performance marketing analyst. Analyze this ad campaign and provide actionable feedback.

Campaign Details:
- Name: ${campaign.name}
- Platform: ${campaign.platform}
- Objective: ${campaign.objective}
- Daily Budget: $${(campaign.dailyBudgetCents / 100).toFixed(2)}
- Status: ${campaign.status}
- Headline: "${campaign.creative.headline}"
- Primary Text: "${campaign.creative.primaryText}"
- Description: "${campaign.creative.description || 'None'}"
- CTA: "${campaign.creative.ctaType || 'Default'}"
- Has Image: ${campaign.creative.imageUrl ? 'Yes' : 'No'}
- Has Video: ${campaign.creative.videoUrl ? 'Yes' : 'No'}
- Landing Page: ${campaign.creative.linkUrl || 'Not set'}
- Targeting: Age ${campaign.targeting?.ageMin || 18}-${campaign.targeting?.ageMax || 65}, Gender: ${campaign.targeting?.gender || 'all'}, Locations: ${campaign.targeting?.locations?.join(', ') || 'Default'}
- Interests: ${campaign.targeting?.interests?.join(', ') || 'None specified'}
${hasMetrics ? `
Performance Metrics:
- Impressions: ${metrics.impressions.toLocaleString()}
- Clicks: ${metrics.clicks.toLocaleString()}
- CTR: ${(metrics.ctr * 100).toFixed(2)}%
- CPC: $${(metrics.cpc / 100).toFixed(2)}
- Total Spend: $${(metrics.spend / 100).toFixed(2)}
- Conversions: ${metrics.conversions}
` : 'No performance data yet (campaign may not be launched).'}

Provide your analysis in the following JSON format:
{
  "overallScore": <number 1-100>,
  "scoreLabel": "<Excellent|Good|Average|Needs Work|Poor>",
  "summary": "<2-3 sentence summary>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": [
    {"area": "<area name>", "issue": "<what's wrong>", "suggestion": "<specific action to take>", "impact": "<high|medium|low>"},
    ...
  ],
  "benchmarks": {
    "ctrBenchmark": "<industry avg CTR for this platform/objective>",
    "cpcBenchmark": "<industry avg CPC>",
    "verdict": "<above/below/at benchmark>"
  },
  "creativeScore": <number 1-100>,
  "targetingScore": <number 1-100>,
  "budgetScore": <number 1-100>,
  "quickWins": ["<immediate action 1>", "<immediate action 2>", "<immediate action 3>"]
}

Return ONLY valid JSON, no other text.`;

    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are an expert performance marketing analyst specializing in Meta, Google, and TikTok advertising. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content || '{}';
    let insights;
    try {
      insights = JSON.parse(text);
    } catch {
      insights = { overallScore: 0, summary: text, improvements: [], quickWins: [] };
    }

    return apiOk({ ok: true, insights, campaignId: id });
  } catch (error) {
    return apiError(error);
  }
}
