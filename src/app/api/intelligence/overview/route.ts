import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { requirePermission } from '@/lib/rbac';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { resolveLimits } from '@/lib/stripe/entitlements';
import { intelligencePhaseFlags, loadProductIntelligence } from '@/lib/intelligence/product-state';
import { contentCohorts, decisionOutcome, pillarCoverage, suggestExperiments, weeklyPulse } from '@/lib/intelligence/pulse';

async function completedExperiments(workspaceId: string, productId: string) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/experiments`)
    .where('productId', '==', productId)
    .limit(100)
    .get();
  return snap.docs
    .map((doc): Record<string, unknown> & { id: string } => ({ ...(doc.data() as Record<string, unknown>), id: doc.id }))
    .filter((row) => row.status === 'complete' && row.result && typeof row.result === 'object')
    .map((row) => {
      const result = row.result as { status?: string; effectPercent?: number | null; reason?: string };
      return {
        id: row.id,
        name: String(row.name ?? 'Experiment'),
        hypothesis: typeof row.hypothesis === 'string' ? row.hypothesis : null,
        platform: typeof row.platform === 'string' ? row.platform : null,
        metric: typeof row.metric === 'string' ? row.metric : 'views',
        status: result.status ?? 'inconclusive',
        effectPercent: typeof result.effectPercent === 'number' ? result.effectPercent : null,
        reason: result.reason ?? null,
        evaluatedAt: typeof row.evaluatedAt === 'string' ? row.evaluatedAt : null,
      };
    })
    .sort((a, b) => (b.evaluatedAt ?? '').localeCompare(a.evaluatedAt ?? ''))
    .slice(0, 20);
}

const querySchema = z.object({
  productId: z.string().max(128).optional(),
  /** Bypass the hourly insights cache (the Refresh button). */
  fresh: z.enum(['1', 'true']).optional(),
});

async function aiQuota(workspaceId: string, limits: ReturnType<typeof resolveLimits>) {
  const month = new Date().toISOString().slice(0, 7);
  const usage = await adminDb.doc(`workspaces/${workspaceId}/aiUsageDaily/${month}`).get();
  const data = usage.data() || {};
  return {
    tier: limits.tier,
    aiOperationsUsed: Number(data.aiOperations) || 0,
    aiOperationsLimit: limits.intelligenceAiOperationsPerMonth,
    strategistTurnsUsed: Number(data.strategistTurns) || 0,
    strategistTurnsLimit: limits.strategistTurnsPerMonth,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    await requireIntelligenceAccess(ctx, 'foundation', 'audienceFit', { subscription });
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const limits = resolveLimits(subscription);
    const [productsSnapshot, phases, quota] = await Promise.all([
      adminDb.collection(`workspaces/${ctx.workspaceId}/products`).limit(100).get(),
      intelligencePhaseFlags(ctx),
      aiQuota(ctx.workspaceId, limits),
    ]);
    const products = productsSnapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name || 'Untitled brand') }));
    const productId = query.productId || products[0]?.id || null;
    if (!productId || !products.some((product) => product.id === productId)) {
      return apiOk({
        products,
        productId: null,
        profile: null,
        totals: null,
        channels: [],
        topContent: [],
        measuredPosts: [],
        learnings: [],
        opportunities: [],
        readiness: null,
        objective: null,
        phases,
        quota,
      });
    }
    const [loaded, experimentResults] = await Promise.all([
      loadProductIntelligence(ctx.workspaceId, productId, { allowCached: !query.fresh }),
      phases.advanced ? completedExperiments(ctx.workspaceId, productId).catch(() => []) : Promise.resolve([]),
    ]);
    const { insights } = loaded;
    const now = new Date();
    const measured = insights.rollup.measuredPosts;
    const decided = [...loaded.storedOpportunities, ...loaded.storedLearnings]
      .filter((row) => (row.status === 'accepted' || row.status === 'pinned') && typeof row.decidedAt === 'string');
    const outcomes = Object.fromEntries(decided.map((row) => [row.id, decisionOutcome(measured, row.decidedAt as string, now)]));
    const suggestedExperiments = phases.advanced
      ? suggestExperiments({
          windows: insights.timing?.windows?.filter((w) => w.label === 'measured') ?? [],
          learnings: insights.learnings,
          channels: insights.rollup.channels,
          metric: insights.objective.metric,
        })
      : [];
    return apiOk({
      products,
      productId,
      profile: loaded.profile,
      phases,
      quota,
      totals: {
        posts: loaded.postsCount,
        ...insights.rollup.totals,
        coverage: insights.rollup.coverage,
      },
      channels: insights.rollup.channels,
      topContent: insights.rollup.topContent,
      measuredPosts: insights.rollup.measuredPosts,
      alignment: phases.learning ? insights.alignment : null,
      timing: phases.learning ? insights.timing : null,
      drift: phases.growth ? insights.drift : null,
      // Dismissed items are included so the client can offer review and undo.
      learnings: phases.learning ? insights.learnings : [],
      opportunities: phases.growth ? insights.opportunities : [],
      readiness: insights.readiness,
      objective: insights.objective,
      pulse: weeklyPulse(measured, now),
      cohorts: phases.learning ? contentCohorts(measured) : null,
      pillars: phases.learning ? pillarCoverage(measured, loaded.profile?.contentPillars ?? [], now) : [],
      outcomes,
      suggestedExperiments,
      experimentResults,
      computedAt: loaded.computedAt,
      cached: loaded.cached,
    });
  } catch (error) {
    return apiError(error);
  }
}
