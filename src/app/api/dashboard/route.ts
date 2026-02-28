import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const ws = ctx.workspaceId;

    // Run aggregation queries in parallel
    const [contactsSnap, campaignsSnap, automationsSnap, jobsSnap, productsSnap, recentRunsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/contacts`).get(),
        adminDb.collection(`workspaces/${ws}/campaigns`).get(),
        adminDb.collection(`workspaces/${ws}/automations`).get(),
        adminDb.collection(`workspaces/${ws}/jobs`).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb
          .collection(`workspaces/${ws}/job_runs`)
          .orderBy('startedAt', 'desc')
          .limit(10)
          .get(),
      ]);

    // Compute contact stats
    const contacts = contactsSnap.docs.map((d) => d.data());
    const totalContacts = contacts.length;
    const activeContacts = contacts.filter((c) => c.status === 'active').length;
    const pendingContacts = contacts.filter((c) => c.status === 'pending').length;
    const bouncedContacts = contacts.filter(
      (c) => c.status === 'bounced' || c.status === 'unsubscribed',
    ).length;

    // Compute campaign stats
    const campaigns = campaignsSnap.docs.map((d) => d.data());
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
    const draftCampaigns = campaigns.filter((c) => c.status === 'draft').length;

    // Automations
    const automations = automationsSnap.docs.map((d) => d.data());
    const enabledAutomations = automations.filter((a) => a.enabled).length;

    // Products
    const products = productsSnap.docs.map((d) => d.data());
    const activeProducts = products.filter((p) => p.status === 'active').length;

    // Jobs
    const jobs = jobsSnap.docs.map((d) => d.data());
    const enabledJobs = jobs.filter((j) => j.enabled).length;

    // Recent activity (from job runs)
    const recentActivity = recentRunsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    return apiOk({
      workspaceId: ws,
      metrics: {
        totalContacts,
        activeContacts,
        pendingContacts,
        bouncedContacts,
        totalCampaigns,
        activeCampaigns,
        draftCampaigns,
        totalAutomations: automations.length,
        enabledAutomations,
        totalProducts: products.length,
        activeProducts,
        totalJobs: jobs.length,
        enabledJobs,
      },
      recentActivity,
    });
  } catch (error) {
    return apiError(error);
  }
}
