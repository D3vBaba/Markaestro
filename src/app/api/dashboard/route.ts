import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';

type RecentPost = {
  id: string;
  channel?: string;
  status?: string;
  content?: string;
  publishedAt?: string;
  scheduledAt?: string;
  createdAt?: string;
};

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const ws = ctx.workspaceId;

    const [campaignsSnap, productsSnap, postsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/campaigns`).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb.collection(`workspaces/${ws}/posts`).get(),
      ]);

    const campaigns = campaignsSnap.docs.map((d) => d.data());
    const products = productsSnap.docs.map((d) => d.data());
    const posts = postsSnap.docs.map((d) => d.data());
    // Campaign stats
    const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
    const draftCampaigns = campaigns.filter((c) => c.status === 'draft').length;

    // Post stats
    const publishedPosts = posts.filter((p) => p.status === 'published').length;
    const scheduledPosts = posts.filter((p) => p.status === 'scheduled').length;

    // Posts by channel
    const postsByChannel: Record<string, number> = {};
    for (const p of posts) {
      const channel = p.channel || 'unknown';
      postsByChannel[channel] = (postsByChannel[channel] || 0) + 1;
    }

    // Posts published per day (last 7 days)
    const now = new Date();
    const dailyPosts: { date: string; label: string; published: number; scheduled: number }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const published = posts.filter(
        (p) => p.status === 'published' && p.publishedAt && p.publishedAt.startsWith(dateStr),
      ).length;
      const scheduled = posts.filter(
        (p) => p.status === 'scheduled' && p.scheduledAt && p.scheduledAt.startsWith(dateStr),
      ).length;
      dailyPosts.push({ date: dateStr, label: dayNames[d.getDay()], published, scheduled });
    }

    // Recent posts (latest 5 published or scheduled)
    const recentPosts = postsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as RecentPost))
      .filter((p) => p.status === 'published' || p.status === 'scheduled')
      .sort((a, b) => {
        const aDate = a.publishedAt || a.scheduledAt || a.createdAt || '';
        const bDate = b.publishedAt || b.scheduledAt || b.createdAt || '';
        return bDate.localeCompare(aDate);
      })
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        channel: p.channel,
        status: p.status,
        content: (p.content || '').slice(0, 80),
        date: p.publishedAt || p.scheduledAt || p.createdAt,
      }));

    return apiOk({
      workspaceId: ws,
      metrics: {
        totalProducts: products.length,
        activeProducts: products.filter((p) => p.status === 'active').length,
        totalCampaigns: campaigns.length,
        activeCampaigns,
        draftCampaigns,
        totalPosts: posts.length,
        publishedPosts,
        scheduledPosts,
        postsByChannel,
      },
      dailyPosts,
      recentPosts,
    });
  } catch (error) {
    return apiError(error);
  }
}
