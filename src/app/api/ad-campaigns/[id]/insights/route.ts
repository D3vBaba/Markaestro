import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import type { AdCampaignDoc, MetricsSnapshot } from '@/lib/ads/types';
import OpenAI from 'openai';

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
}

/**
 * Industry benchmark reference used to ground the AI's analysis.
 * Sources: WordStream, HubSpot, Meta Business, TikTok for Business benchmarks 2024.
 */
const BENCHMARK_REFERENCE = `
INDUSTRY BENCHMARKS (use these as your reference — do not invent numbers):

Meta (Facebook/Instagram):
  Awareness     → CTR 0.9–1.5%,  CPM $5–15,    CPC $0.50–1.50
  Traffic       → CTR 1.5–3.0%,  CPM $8–18,    CPC $0.50–2.00
  Engagement    → CTR 0.5–1.0%,  CPM $3–10,    CPC $0.10–0.50
  Leads         → CTR 0.5–2.0%,  CPL $5–25
  eCommerce ROAS → 2.0–4.0x (strong: >4x, poor: <1.5x)
  Creative fatigue threshold → frequency >3.0 in 7 days

TikTok Ads:
  Awareness     → CTR 1.0–3.0%,  CPM $5–15,    CPC $0.20–1.50
  Traffic       → CTR 1.0–3.0%,  CPC $0.20–1.50
  Video completion rate 25–50% is average; >60% is strong
  eCommerce ROAS → 1.5–3.0x (newer platform, lower purchase intent)
  Frequency benchmark → aim for 1.5–2.5x per week
`.trim();

/**
 * Summarise the last 7 days of metric history to surface trends.
 */
function buildTrendSummary(history: MetricsSnapshot[]): string {
  if (history.length < 2) return 'Insufficient history for trend analysis (need at least 2 sync points).';

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];

  function delta(newVal: number, oldVal: number): string {
    if (oldVal === 0) return newVal > 0 ? '+∞' : '0%';
    const pct = ((newVal - oldVal) / oldVal) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  const lines: string[] = [
    `Period: ${oldest.date} → ${newest.date} (${sorted.length} snapshots)`,
    `Impressions: ${oldest.impressions.toLocaleString()} → ${newest.impressions.toLocaleString()} (${delta(newest.impressions, oldest.impressions)})`,
    `Clicks: ${oldest.clicks.toLocaleString()} → ${newest.clicks.toLocaleString()} (${delta(newest.clicks, oldest.clicks)})`,
    `CTR: ${(oldest.ctr * 100).toFixed(2)}% → ${(newest.ctr * 100).toFixed(2)}%`,
    `Spend: $${(oldest.spend / 100).toFixed(2)} → $${(newest.spend / 100).toFixed(2)}`,
    `Conversions: ${oldest.conversions} → ${newest.conversions} (${delta(newest.conversions, oldest.conversions)})`,
  ];
  if (newest.roas > 0 || oldest.roas > 0) {
    lines.push(`ROAS: ${oldest.roas.toFixed(2)}x → ${newest.roas.toFixed(2)}x`);
  }
  if (newest.frequency > 0) {
    lines.push(`Frequency: ${oldest.frequency.toFixed(2)} → ${newest.frequency.toFixed(2)} (creative fatigue risk if >3.0)`);
  }
  if (newest.videoViews > 0) {
    lines.push(`Video Views: ${oldest.videoViews.toLocaleString()} → ${newest.videoViews.toLocaleString()} (${delta(newest.videoViews, oldest.videoViews)})`);
  }
  return lines.join('\n');
}

/**
 * GET /api/ad-campaigns/[id]/insights
 * Generate AI-powered performance insights for a specific campaign.
 * Uses gpt-4o with real benchmark data and trend history.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const [snap, historySnap] = await Promise.all([
      ref.get(),
      ref.collection('metrics_history').orderBy('date', 'desc').limit(7).get(),
    ]);

    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = snap.data() as AdCampaignDoc;
    const history = historySnap.docs.map((d) => d.data() as MetricsSnapshot);

    const metrics = campaign.metrics;
    const hasMetrics = !!(metrics && metrics.impressions > 0);
    const convRate = metrics && metrics.clicks > 0
      ? ((metrics.conversions / metrics.clicks) * 100).toFixed(2)
      : null;
    const costPerConversion = metrics && metrics.conversions > 0
      ? `$${(metrics.spend / metrics.conversions / 100).toFixed(2)}`
      : null;

    const metricsBlock = hasMetrics ? `
PERFORMANCE METRICS (lifetime):
- Impressions: ${metrics!.impressions.toLocaleString()}
- Reach: ${metrics!.reach > 0 ? metrics!.reach.toLocaleString() : 'N/A (not reported by this platform)'}
- Frequency: ${metrics!.frequency > 0 ? metrics!.frequency.toFixed(2) + 'x' : 'N/A'}
- Clicks: ${metrics!.clicks.toLocaleString()}
- CTR: ${(metrics!.ctr * 100).toFixed(2)}%
- CPC: $${(metrics!.cpc / 100).toFixed(2)}
- Total Spend: $${(metrics!.spend / 100).toFixed(2)}
- Conversions: ${metrics!.conversions}
- Conversion Rate: ${convRate !== null ? convRate + '%' : 'N/A'}
- Cost Per Conversion: ${costPerConversion || 'N/A'}
- ROAS: ${metrics!.roas > 0 ? metrics!.roas.toFixed(2) + 'x' : 'No conversion value tracked'}
- Conversion Value: ${metrics!.conversionValue > 0 ? '$' + (metrics!.conversionValue / 100).toFixed(2) : 'N/A'}
${metrics!.videoViews > 0 ? `- Video Views: ${metrics!.videoViews.toLocaleString()}
- Avg Watch Time: ${metrics!.videoWatchTime > 0 ? metrics!.videoWatchTime.toFixed(1) + 's' : 'N/A'}` : ''}` : 'No performance data yet — campaign may not be launched.';

    const trendBlock = history.length > 0
      ? `\nTREND ANALYSIS (last ${history.length} syncs):\n${buildTrendSummary(history)}`
      : '\nNo trend history available yet.';

    const prompt = `You are a senior performance marketing analyst. Analyze this ad campaign using the benchmark data provided and give specific, actionable recommendations.

${BENCHMARK_REFERENCE}

---

CAMPAIGN DETAILS:
- Name: ${campaign.name}
- Platform: ${campaign.platform.toUpperCase()}
- Objective: ${campaign.objective}
- Daily Budget: $${(campaign.dailyBudgetCents / 100).toFixed(2)}
- Status: ${campaign.status}
- Start Date: ${campaign.startDate || 'N/A'}

CREATIVE:
- Headline: "${campaign.creative.headline}"
- Primary Text: "${campaign.creative.primaryText}"
- Description: "${campaign.creative.description || 'None'}"
- CTA: "${campaign.creative.ctaType || 'Default'}"
- Has Image: ${campaign.creative.imageUrl ? 'Yes' : 'No'}
- Has Video: ${campaign.creative.videoUrl ? 'Yes' : 'No'}
- Landing Page: ${campaign.creative.linkUrl || 'Not set'}

TARGETING:
- Age: ${campaign.targeting?.ageMin || 18}–${campaign.targeting?.ageMax || 65}
- Gender: ${campaign.targeting?.gender || 'All'}
- Locations: ${campaign.targeting?.locations?.join(', ') || 'Default'}
- Interests: ${campaign.targeting?.interests?.join(', ') || 'None specified'}
${campaign.targeting?.keywords?.length ? `- Keywords: ${campaign.targeting.keywords.join(', ')}` : ''}
${metricsBlock}
${trendBlock}

Respond with this exact JSON structure:
{
  "overallScore": <1-100>,
  "scoreLabel": "<Excellent|Good|Average|Needs Work|Poor>",
  "summary": "<2-3 sentences grounded in actual numbers and trend direction>",
  "strengths": ["<specific strength with metric evidence>", ...],
  "improvements": [
    {
      "area": "<Creative|Targeting|Budget|Bidding|Keywords|Landing Page|Frequency|ROAS>",
      "issue": "<specific issue with metric reference>",
      "suggestion": "<concrete, platform-specific action to take>",
      "impact": "<high|medium|low>"
    }
  ],
  "benchmarks": {
    "ctrBenchmark": "<exact benchmark range from the reference above>",
    "cpcBenchmark": "<exact benchmark range from the reference above>",
    "verdict": "<above benchmark|at benchmark|below benchmark|insufficient data>"
  },
  "creativeScore": <1-100>,
  "targetingScore": <1-100>,
  "budgetScore": <1-100>,
  "quickWins": ["<immediate, specific action>", "<immediate, specific action>", "<immediate, specific action>"]
}

Be specific. Reference actual numbers. Never invent benchmarks outside the reference table above.`;

    const client = getClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1800,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert performance marketing analyst for Meta and TikTok. You produce specific, data-grounded analysis and never vague advice. Always return valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content || '{}';
    let insights;
    try {
      insights = JSON.parse(text);
    } catch {
      insights = { overallScore: 0, summary: 'Analysis failed — please try again.', improvements: [], quickWins: [] };
    }

    return apiOk({ ok: true, insights, campaignId: id, hasHistory: history.length > 0 });
  } catch (error) {
    return apiError(error);
  }
}
