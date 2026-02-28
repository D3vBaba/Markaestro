import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const ws = ctx.workspaceId;

    // Gather all data in parallel
    const [contactsSnap, campaignsSnap, eventsSnap, productsSnap, jobRunsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/contacts`).get(),
        adminDb.collection(`workspaces/${ws}/campaigns`).get(),
        adminDb.collection(`workspaces/${ws}/events`).orderBy('timestamp', 'desc').limit(500).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb.collection(`workspaces/${ws}/job_runs`).orderBy('startedAt', 'desc').limit(100).get(),
      ]);

    const contacts = contactsSnap.docs.map((d) => d.data());
    const campaigns = campaignsSnap.docs.map((d) => d.data());
    const events = eventsSnap.docs.map((d) => d.data());
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; [key: string]: unknown }) }));

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

    return apiOk({
      overview: {
        totalContacts: contacts.length,
        totalCampaigns: campaigns.length,
        totalEvents: events.length,
        totalProducts: products.length,
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
    });
  } catch (error) {
    return apiError(error);
  }
}
