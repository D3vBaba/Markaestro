import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const ws = ctx.workspaceId;

    const [eventsSnap, productsSnap, postsSnap] =
      await Promise.all([
        adminDb.collection(`workspaces/${ws}/events`).orderBy('timestamp', 'desc').limit(500).get(),
        adminDb.collection(`workspaces/${ws}/products`).get(),
        adminDb.collection(`workspaces/${ws}/posts`).get(),
      ]);

    const events = eventsSnap.docs.map((d) => d.data());
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; [key: string]: unknown }) }));
    const posts = postsSnap.docs.map((d) => d.data());

    const eventCounts: Record<string, number> = {};
    for (const e of events) {
      const type = e.type || 'unknown';
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    }

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

    const productStats = products.map((p) => ({
      id: p.id,
      name: p.name,
      posts: posts.filter((post) => post.productId === p.id).length,
    }));

    const postsByStatus: Record<string, number> = {};
    const postsByChannel: Record<string, number> = {};
    for (const p of posts) {
      const status = p.status || 'draft';
      postsByStatus[status] = (postsByStatus[status] || 0) + 1;
      const channel = p.channel || 'unknown';
      postsByChannel[channel] = (postsByChannel[channel] || 0) + 1;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentPublished = posts.filter(
      (p) => p.status === 'published' && p.publishedAt && new Date(p.publishedAt) >= sevenDaysAgo,
    ).length;

    return apiOk({
      overview: {
        totalEvents: events.length,
        totalProducts: products.length,
        totalPosts: posts.length,
      },
      eventCounts,
      dailyActivity,
      productStats,
      postStats: {
        total: posts.length,
        byStatus: postsByStatus,
        byChannel: postsByChannel,
        recentPublished,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
