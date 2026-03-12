import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const ws = ctx.workspaceId;

    // Gather all data in parallel
    const [contactsSnap, campaignsSnap, eventsSnap, productsSnap, jobRunsSnap, postsSnap, adCampaignsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/contacts`).get(),
        adminDb.collection(`workspaces/${ws}/campaigns`).get(),
        adminDb.collection(`workspaces/${ws}/events`).orderBy('timestamp', 'desc').limit(500).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb.collection(`workspaces/${ws}/job_runs`).orderBy('startedAt', 'desc').limit(100).get(),
        adminDb.collection(`workspaces/${ws}/posts`).get(),
        adminDb.collection(`workspaces/${ws}/ad_campaigns`).get(),
      ]);

    const contacts = contactsSnap.docs.map((d) => d.data());
    const campaigns = campaignsSnap.docs.map((d) => d.data());
    const events = eventsSnap.docs.map((d) => d.data());
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; [key: string]: unknown }) }));
    const posts = postsSnap.docs.map((d) => d.data());

    // Lifecycle funnel
    const lifecycleFunnel = {
      lead: contacts.filter((c) => c.lifecycleStage === 'lead' || !c.lifecycleStage).length,
      trial: contacts.filter((c) => c.lifecycleStage === 'trial').length,
      customer: contacts.filter((c) => c.lifecycleStage === 'customer').length,
      churned: contacts.filter((c) => c.lifecycleStage === 'churned').length,
      advocate: contacts.filter((c) => c.lifecycleStage === 'advocate').length,
    };

    // Source breakdown
    const sourceBreakdown: Record<string, number> = {};
    for (const c of contacts) {
      const src = c.source || 'direct';
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    }

    // Campaign performance
    const campaignStats = campaigns.map((c) => ({
      name: c.name,
      channel: c.channel,
      status: c.status,
      lastSentCount: c.lastSentCount || 0,
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

    // Job success rate
    const jobRuns = jobRunsSnap.docs.map((d) => d.data());
    const successRuns = jobRuns.filter((r) => r.status === 'success').length;
    const failedRuns = jobRuns.filter((r) => r.status === 'failed').length;

    // Per-product contact counts
    const productStats = products.map((p) => ({
      id: p.id,
      name: p.name,
      contacts: contacts.filter((c) => c.productId === p.id).length,
      campaigns: campaigns.filter((c) => c.productId === p.id).length,
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
        totalContacts: contacts.length,
        totalCampaigns: campaigns.length,
        totalEvents: events.length,
        totalProducts: products.length,
        totalPosts: posts.length,
        totalAdCampaigns: adCampaigns.length,
      },
      lifecycleFunnel,
      sourceBreakdown,
      campaignStats,
      eventCounts,
      dailyActivity,
      jobPerformance: {
        totalRuns: jobRuns.length,
        successRuns,
        failedRuns,
        successRate: jobRuns.length > 0 ? Math.round((successRuns / jobRuns.length) * 100) : 0,
      },
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
