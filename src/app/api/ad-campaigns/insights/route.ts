import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import OpenAI from 'openai';

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
}

/**
 * Generate aggregate AI insights across all ad campaigns + social posts.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const ws = ctx.workspaceId;

    const [adSnap, postsSnap] = await Promise.all([
      adminDb.collection(`workspaces/${ws}/ad_campaigns`).get(),
      adminDb.collection(`workspaces/${ws}/posts`).get(),
    ]);

    const adCampaigns = adSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const posts = postsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Build aggregated data summary
    const adSummary = adCampaigns.map((c: Record<string, unknown>) => {
      const m = c.metrics as Record<string, number> | undefined;
      return {
        name: c.name,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        budget: `$${((c.dailyBudgetCents as number) / 100).toFixed(2)}/day`,
        impressions: m?.impressions || 0,
        clicks: m?.clicks || 0,
        ctr: m?.ctr ? `${(m.ctr * 100).toFixed(2)}%` : 'N/A',
        spend: m?.spend ? `$${(m.spend / 100).toFixed(2)}` : '$0',
        conversions: m?.conversions || 0,
      };
    });

    const postSummary = {
      total: posts.length,
      published: posts.filter((p: Record<string, unknown>) => p.status === 'published').length,
      failed: posts.filter((p: Record<string, unknown>) => p.status === 'failed').length,
      byChannel: {} as Record<string, number>,
    };
    for (const p of posts) {
      const ch = (p as Record<string, unknown>).channel as string || 'unknown';
      postSummary.byChannel[ch] = (postSummary.byChannel[ch] || 0) + 1;
    }

    if (adCampaigns.length === 0 && posts.length === 0) {
      return apiOk({
        ok: true,
        insights: {
          summary: 'No campaigns or posts yet. Create your first ad campaign or social post to get performance insights.',
          recommendations: [],
          topPerformer: null,
          underperformer: null,
        },
      });
    }

    const prompt = `You are a senior marketing strategist. Analyze the following ad campaigns and social media performance data and provide strategic recommendations.

AD CAMPAIGNS (${adCampaigns.length} total):
${JSON.stringify(adSummary, null, 2)}

SOCIAL POSTS SUMMARY:
${JSON.stringify(postSummary, null, 2)}

Provide your analysis as JSON:
{
  "summary": "<3-4 sentence executive summary of overall marketing performance>",
  "healthScore": <number 1-100>,
  "recommendations": [
    {"priority": "<high|medium|low>", "category": "<creative|targeting|budget|content|strategy>", "title": "<short title>", "description": "<detailed recommendation>"},
    ...
  ],
  "topPerformer": {"name": "<campaign/channel name>", "reason": "<why it's performing well>"},
  "underperformer": {"name": "<campaign/channel name>", "reason": "<why it's underperforming>", "fix": "<specific fix>"},
  "budgetAdvice": "<should they increase/decrease/reallocate budget and why>",
  "platformInsights": [
    {"platform": "<meta|google|tiktok|x|facebook|instagram>", "verdict": "<strong|average|weak|unused>", "tip": "<platform-specific tip>"}
  ],
  "contentTips": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "nextSteps": ["<actionable step 1>", "<actionable step 2>", "<actionable step 3>"]
}

Return ONLY valid JSON, no other text.`;

    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are an expert marketing strategist who provides data-driven recommendations. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content || '{}';
    let insights;
    try {
      insights = JSON.parse(text);
    } catch {
      insights = { summary: text, recommendations: [], nextSteps: [] };
    }

    return apiOk({
      ok: true,
      insights,
      meta: {
        adCampaignCount: adCampaigns.length,
        postCount: posts.length,
        analyzedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
