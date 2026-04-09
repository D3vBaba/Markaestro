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

const BENCHMARK_REFERENCE = `
INDUSTRY BENCHMARKS (reference only — do not invent numbers outside these ranges):
Meta:       avg CTR 0.9–3%, avg CPC $0.10–2.00, ROAS 2–4x. Frequency >3 = creative fatigue.
TikTok:     avg CTR 1–3%, avg CPC $0.20–1.50, ROAS 1.5–3x. Video completion >50% = strong.
`.trim();

type PostDoc = Record<string, unknown>;
type CampaignDoc = Record<string, unknown>;

type PostEngagement = {
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
  impressions?: number;
  videoViews?: number;
};

/**
 * Summarise post engagement across published posts.
 */
function buildPostEngagementSummary(posts: PostDoc[]): {
  total: number;
  published: number;
  failed: number;
  byChannel: Record<string, number>;
  engagementTotals: {
    likes: number; comments: number; shares: number; reach: number; videoViews: number;
  };
  topPost: { channel: string; likes: number; videoViews: number; content: string } | null;
} {
  const summary = {
    total: posts.length,
    published: 0,
    failed: 0,
    byChannel: {} as Record<string, number>,
    engagementTotals: { likes: 0, comments: 0, shares: 0, reach: 0, videoViews: 0 },
    topPost: null as { channel: string; likes: number; videoViews: number; content: string } | null,
  };

  let topScore = 0;

  for (const p of posts) {
    if (p.status === 'published') summary.published++;
    if (p.status === 'failed') summary.failed++;

    const ch = (p.channel as string) || 'unknown';
    summary.byChannel[ch] = (summary.byChannel[ch] || 0) + 1;

    const eng = p.engagement as PostEngagement | undefined;
    if (eng) {
      summary.engagementTotals.likes += eng.likes || 0;
      summary.engagementTotals.comments += eng.comments || 0;
      summary.engagementTotals.shares += eng.shares || 0;
      summary.engagementTotals.reach += eng.reach || 0;
      summary.engagementTotals.videoViews += eng.videoViews || 0;

      const score = (eng.likes || 0) + (eng.comments || 0) * 2 + (eng.shares || 0) * 3 + (eng.videoViews || 0) * 0.1;
      if (score > topScore) {
        topScore = score;
        summary.topPost = {
          channel: ch,
          likes: eng.likes || 0,
          videoViews: eng.videoViews || 0,
          content: ((p.content as string) || '').substring(0, 120),
        };
      }
    }
  }

  return summary;
}

/**
 * GET /api/ad-campaigns/insights
 * Generate aggregate AI insights across all ad campaigns + social post engagement.
 * Uses gpt-4o with benchmark grounding and real engagement data.
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

    const adCampaigns = adSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CampaignDoc));
    const posts = postsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PostDoc));

    if (adCampaigns.length === 0 && posts.length === 0) {
      return apiOk({
        ok: true,
        insights: {
          summary: 'No campaigns or posts yet. Create your first ad campaign or social post to get performance insights.',
          recommendations: [],
          topPerformer: null,
          underperformer: null,
          healthScore: 0,
        },
      });
    }

    // Build rich campaign summaries with derived metrics
    const adSummary = adCampaigns.map((c) => {
      const m = c.metrics as Record<string, number> | undefined;
      const spend = m?.spend || 0;
      const clicks = m?.clicks || 0;
      const conversions = m?.conversions || 0;
      const convRate = clicks > 0 ? ((conversions / clicks) * 100).toFixed(2) + '%' : 'N/A';
      const cpa = conversions > 0 ? '$' + (spend / conversions / 100).toFixed(2) : 'N/A';
      return {
        name: c.name,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        dailyBudget: `$${((c.dailyBudgetCents as number) / 100).toFixed(2)}/day`,
        impressions: m?.impressions || 0,
        clicks,
        ctr: m?.ctr ? `${(m.ctr * 100).toFixed(2)}%` : 'N/A',
        cpc: m?.cpc ? `$${(m.cpc / 100).toFixed(2)}` : 'N/A',
        spend: spend > 0 ? `$${(spend / 100).toFixed(2)}` : '$0',
        conversions,
        conversionRate: convRate,
        costPerConversion: cpa,
        roas: m?.roas ? `${(m.roas).toFixed(2)}x` : 'N/A',
        reach: m?.reach || 0,
        frequency: m?.frequency ? (m.frequency).toFixed(2) : 'N/A',
        videoViews: m?.videoViews || 0,
      };
    });

    const postSummary = buildPostEngagementSummary(posts);

    const hasAnyMetrics = adCampaigns.some((c) => {
      const m = c.metrics as Record<string, number> | undefined;
      return m && m.impressions > 0;
    });

    const hasEngagement = postSummary.engagementTotals.likes > 0 ||
      postSummary.engagementTotals.videoViews > 0;

    const prompt = `You are a senior marketing strategist. Analyze this account's full marketing performance — paid ads AND organic social — and provide strategic, data-grounded recommendations.

${BENCHMARK_REFERENCE}

---

AD CAMPAIGNS (${adCampaigns.length} total):
${JSON.stringify(adSummary, null, 2)}

ORGANIC SOCIAL POSTS:
- Total posts: ${postSummary.total}
- Published: ${postSummary.published}, Failed: ${postSummary.failed}
- By channel: ${JSON.stringify(postSummary.byChannel)}
${hasEngagement ? `- Engagement totals: ${JSON.stringify(postSummary.engagementTotals)}
- Top post: ${postSummary.topPost ? JSON.stringify(postSummary.topPost) : 'None'}` : '- No engagement data yet (posts not synced)'}

DATA CONTEXT: ${hasAnyMetrics ? 'Real performance data available.' : 'Most campaigns have no data yet — likely not launched. Focus on setup and strategy recommendations.'}

Return this exact JSON:
{
  "summary": "<3-4 sentences. Reference real numbers. Identify the single biggest opportunity.>",
  "healthScore": <1-100, based on real data quality and performance vs. benchmarks>,
  "recommendations": [
    {
      "priority": "<high|medium|low>",
      "category": "<creative|targeting|budget|content|strategy|frequency|roas>",
      "title": "<≤8 word title>",
      "description": "<specific action with expected outcome. Reference metrics or benchmarks.>"
    }
  ],
  "topPerformer": { "name": "<campaign or channel name>", "reason": "<specific metric that makes it top>" } | null,
  "underperformer": { "name": "<name>", "reason": "<specific metric evidence>", "fix": "<one concrete action>" } | null,
  "budgetAdvice": "<should they increase/decrease/reallocate — cite specific campaign data and ROAS if available>",
  "platformInsights": [
    { "platform": "<meta|tiktok>", "verdict": "<strong|average|weak|unused>", "tip": "<one specific, actionable platform tip>" }
  ],
  "contentTips": ["<specific organic content recommendation based on engagement data>", ...],
  "nextSteps": ["<most impactful action 1>", "<most impactful action 2>", "<most impactful action 3>"]
}

Be specific. If data is thin, say so and focus on setup recommendations. Never fabricate metrics.`;

    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2200,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert marketing strategist who provides data-driven, specific recommendations for Meta and TikTok. Always return valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content || '{}';
    let insights;
    try {
      insights = JSON.parse(text);
    } catch {
      insights = { summary: 'Analysis failed — please try again.', recommendations: [], nextSteps: [] };
    }

    return apiOk({
      ok: true,
      insights,
      meta: {
        adCampaignCount: adCampaigns.length,
        postCount: posts.length,
        postsWithEngagement: posts.filter((p) => !!(p as PostDoc).engagement).length,
        analyzedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
