import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligencePhase } from '@/lib/intelligence/feature-flags';
import { requireIntelligencePreviewUser } from '@/lib/intelligence/preview-access';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature } from '@/lib/stripe/entitlements';
import { intelligencePhaseFlags, loadProductIntelligence } from '@/lib/intelligence/product-state';

const querySchema = z.object({ productId: z.string().max(128).optional() });

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireIntelligencePreviewUser(ctx);
    requirePermission(ctx, 'intelligence.read');
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligencePhase({
      phase: 'foundation',
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      entitled: hasFeature(subscription, 'audienceFit'),
    });
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const productsSnapshot = await adminDb.collection(`workspaces/${ctx.workspaceId}/products`).limit(100).get();
    const products = productsSnapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name || 'Untitled brand') }));
    const productId = query.productId || products[0]?.id || null;
    const phases = await intelligencePhaseFlags(ctx);
    if (!productId || !products.some((product) => product.id === productId)) {
      return apiOk({
        products,
        productId: null,
        profile: null,
        totals: null,
        channels: [],
        topContent: [],
        learnings: [],
        opportunities: [],
        phases,
      });
    }
    const loaded = await loadProductIntelligence(ctx.workspaceId, productId);
    const { insights } = loaded;
    return apiOk({
      products,
      productId,
      profile: loaded.profile,
      phases,
      totals: {
        posts: loaded.posts.length,
        ...insights.rollup.totals,
        coverage: insights.rollup.coverage,
      },
      channels: insights.rollup.channels,
      topContent: insights.rollup.topContent,
      measuredPosts: phases.experiments ? insights.rollup.measuredPosts : [],
      alignment: phases.learning ? insights.alignment : null,
      timing: phases.learning ? insights.timing : null,
      drift: phases.growth ? insights.drift : null,
      learnings: phases.learning ? insights.learnings.filter((item) => item.status !== 'dismissed') : [],
      opportunities: phases.growth ? insights.opportunities.filter((item) => item.status !== 'dismissed') : [],
      labels: {
        totals: 'measured',
        coverage: 'calculated',
        opportunities: 'recommended',
        timing: 'calculated',
        alignment: 'calculated',
        drift: 'calculated',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
