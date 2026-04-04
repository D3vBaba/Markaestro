import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const ws = ctx.workspaceId;

    const [campaignsSnap, eventsSnap, productsSnap, postsSnap, adCampaignsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/campaigns`).get(),
        adminDb.collection(`workspaces/${ws}/events`).orderBy('timestamp', 'desc').limit(500).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb.collection(`workspaces/${ws}/posts`).get(),
        adminDb.collection(`workspaces/${ws}/ad_campaigns`).get(),
      ]);

    const campaigns = campaignsSnap.docs.map((d) => d.data());
    const events = eventsSnap.docs.map((d) => d.data());
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; [key: string]: unknown }) }));
    const posts = postsSnap.docs.map((d) => d.data());

    // Campaign performance
    const campaignStats = campaigns.map((c) => ({
      name: c.name,
      channel: c.channel,
      status: c.status,
    }));

    // Event counts by type
    const eventCounts: Record<string, number> = {};
    for (const e of events) {
      const type = e.type || 'unknown';
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    }

    // Daily event activity (last 7 days)
    const now = new Date();
    const dailyActivity: { date: string; events: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = events.filter(
        (e) => e.timestamp && e.timestamp.startsWith(dateStr),
      ).length;
      dailyActivity.push({ date: dateStr, events: count });
    }

    // Per-product stats
    const productStats = products.map((p) => ({
      id: p.id,
      name: p.name,
      campaigns: campaigns.filter((c) => c.productId === p.id).length,
      posts: posts.filter((post) => post.productId === p.id).length,
    }));

    // Post analytics
    const postsByStatus: Record<string, number> = {};
    const postsByChannel: Record<string, number> = {};
    for (const p of posts) {
      const status = p.status || 'draft';
      postsByStatus[status] = (postsByStatus[status] || 0) + 1;
      const channel = p.channel || 'unknown';
      postsByChannel[channel] = (postsByChannel[channel] || 0) + 1;
    }

    // Posts published in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentPublished = posts.filter(
      (p) => p.status === 'published' && p.publishedAt && new Date(p.publishedAt) >= sevenDaysAgo,
    ).length;

    // Ad campaign analytics
    const adCampaigns = adCampaignsSnap.docs.map((d) => d.data());
    const adsByPlatform: Record<string, number> = {};
    const adsByStatus: Record<string, number> = {};
    let totalAdSpend = 0;
    let totalAdImpressions = 0;
    let totalAdClicks = 0;
    let totalAdConversions = 0;

    for (const ad of adCampaigns) {
      const platform = ad.platform || 'unknown';
      adsByPlatform[platform] = (adsByPlatform[platform] || 0) + 1;
      const status = ad.status || 'draft';
      adsByStatus[status] = (adsByStatus[status] || 0) + 1;

      if (ad.metrics) {
        totalAdSpend += ad.metrics.spend || 0;
        totalAdImpressions += ad.metrics.impressions || 0;
        totalAdClicks += ad.metrics.clicks || 0;
        totalAdConversions += ad.metrics.conversions || 0;
      }
    }

    const topAdCampaigns = adCampaigns
      .filter((a) => a.metrics?.impressions > 0)
      .sort((a, b) => (b.metrics?.clicks || 0) - (a.metrics?.clicks || 0))
      .slice(0, 5)
      .map((a) => ({
        name: a.name,
        platform: a.platform,
        impressions: a.metrics?.impressions || 0,
        clicks: a.metrics?.clicks || 0,
        spend: a.metrics?.spend || 0,
        ctr: a.metrics?.ctr || 0,
      }));

    return apiOk({
      overview: {
        totalCampaigns: campaigns.length,
        totalEvents: events.length,
        totalProducts: products.length,
        totalPosts: posts.length,
        totalAdCampaigns: adCampaigns.length,
      },
      campaignStats,
      eventCounts,
      dailyActivity,
      productStats,
      postStats: {
        total: posts.length,
        byStatus: postsByStatus,
        byChannel: postsByChannel,
        recentPublished,
      },
      adStats: {
        total: adCampaigns.length,
        byPlatform: adsByPlatform,
        byStatus: adsByStatus,
        totalSpend: totalAdSpend,
        totalImpressions: totalAdImpressions,
        totalClicks: totalAdClicks,
        totalConversions: totalAdConversions,
        avgCtr: totalAdImpressions > 0 ? totalAdClicks / totalAdImpressions : 0,
        topCampaigns: topAdCampaigns,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
