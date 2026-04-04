import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import OpenAI from 'openai';
import type { UnifiedInsights } from '@/lib/social/types';

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
};

const SYSTEM_PROMPT = `You are an expert social media strategist and growth advisor working as a personal social media manager.

Based on the platform performance data provided, give 5-7 specific, actionable recommendations to improve social media presence, increase traffic to their app, and optimize ad spend.

Structure your response as a JSON array of objects, each with:
- "title": a short, punchy title (under 10 words)
- "tip": the actionable recommendation (2-3 sentences max)
- "priority": "high", "medium", or "low"
- "platform": "facebook", "instagram", "tiktok", "cross-platform", or "ads"

Focus on:
- What content types are performing best and how to double down
- Posting frequency and timing recommendations
- Engagement patterns and how to improve them
- Cross-platform strategy (repurposing content)
- Follower growth tactics specific to each platform
- Ad budget optimization if ad data is available
- Specific weaknesses to address (low engagement, inconsistent posting, etc.)

Be specific with numbers when possible. No generic advice like "post consistently" — reference actual data from their profiles. If a platform is not connected, suggest connecting it and explain why.`;

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const { productId } = await params;

    const body = await req.json();
    const insights = body.insights as UnifiedInsights;

    if (!insights) throw new Error('VALIDATION_INSIGHTS_REQUIRED');

    // Get product details for context
    const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}`).get();
    const product = productSnap.data() || {};

    const userPrompt = buildUserPrompt(insights, product);
    const client = getClient();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '[]';

    // Parse the JSON array from the response
    let tips: { title: string; tip: string; priority: string; platform: string }[];
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      tips = JSON.parse(cleaned);
    } catch {
      tips = [{ title: 'Analysis Complete', tip: raw, priority: 'medium', platform: 'cross-platform' }];
    }

    return apiOk({ tips, generatedAt: new Date().toISOString() });
  } catch (error) {
    return apiError(error);
  }
}

function buildUserPrompt(insights: UnifiedInsights, product: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`Product: ${insights.productName}`);
  if (product.description) parts.push(`Description: ${product.description}`);
  if (product.url) parts.push(`App URL: ${product.url}`);
  parts.push('');

  // Facebook
  if (insights.facebook.connected && !insights.facebook.error) {
    parts.push('=== FACEBOOK ===');
    parts.push(`Page: ${insights.facebook.pageName || 'Unknown'}`);
    if (insights.facebook.followers != null) parts.push(`Followers: ${insights.facebook.followers.toLocaleString()}`);
    if (insights.facebook.impressions7d != null) parts.push(`Impressions (7d): ${insights.facebook.impressions7d.toLocaleString()}`);
    if (insights.facebook.engagements7d != null) parts.push(`Engagements (7d): ${insights.facebook.engagements7d.toLocaleString()}`);
    if (insights.facebook.reach7d != null) parts.push(`Reach (7d): ${insights.facebook.reach7d.toLocaleString()}`);

    if (insights.facebook.recentPosts?.length) {
      parts.push(`Recent posts (${insights.facebook.recentPosts.length}):`);
      for (const p of insights.facebook.recentPosts.slice(0, 5)) {
        const msg = p.message ? p.message.slice(0, 80) : '(no text)';
        parts.push(`  - "${msg}" | ${p.likes} likes, ${p.comments} comments, ${p.shares} shares`);
      }
    }
    parts.push('');
  } else if (!insights.facebook.connected) {
    parts.push('=== FACEBOOK: NOT CONNECTED ===');
    parts.push('');
  }

  // Instagram
  if (insights.instagram.connected && !insights.instagram.error) {
    parts.push('=== INSTAGRAM ===');
    if (insights.instagram.followersCount != null) parts.push(`Followers: ${insights.instagram.followersCount.toLocaleString()}`);
    if (insights.instagram.mediaCount != null) parts.push(`Total posts: ${insights.instagram.mediaCount}`);

    if (insights.instagram.recentMedia?.length) {
      parts.push(`Recent media (${insights.instagram.recentMedia.length}):`);
      for (const m of insights.instagram.recentMedia.slice(0, 5)) {
        const cap = m.caption ? m.caption.slice(0, 80) : '(no caption)';
        parts.push(`  - [${m.mediaType}] "${cap}" | ${m.likes} likes, ${m.comments} comments`);
      }
    }
    parts.push('');
  } else if (!insights.instagram.connected) {
    parts.push('=== INSTAGRAM: NOT CONNECTED ===');
    parts.push('');
  }

  // TikTok
  if (insights.tiktok.connected && !insights.tiktok.error) {
    parts.push('=== TIKTOK ===');
    parts.push(`Account: ${insights.tiktok.displayName || 'Unknown'}`);
    if (insights.tiktok.followers != null) parts.push(`Followers: ${insights.tiktok.followers.toLocaleString()}`);
    if (insights.tiktok.totalLikes != null) parts.push(`Total likes: ${insights.tiktok.totalLikes.toLocaleString()}`);
    if (insights.tiktok.videoCount != null) parts.push(`Total videos: ${insights.tiktok.videoCount}`);

    if (insights.tiktok.recentVideos?.length) {
      parts.push(`Recent videos (${insights.tiktok.recentVideos.length}):`);
      for (const v of insights.tiktok.recentVideos.slice(0, 5)) {
        const title = v.title || '(untitled)';
        parts.push(`  - "${title}" | ${v.views.toLocaleString()} views, ${v.likes} likes, ${v.comments} comments, ${v.shares} shares`);
      }
    }
    parts.push('');
  } else if (!insights.tiktok.connected) {
    parts.push('=== TIKTOK: NOT CONNECTED ===');
    parts.push('');
  }

  parts.push('Based on this data, provide specific, actionable social media management tips.');

  return parts.join('\n');
}
