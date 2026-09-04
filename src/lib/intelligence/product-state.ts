import { adminDb } from '@/lib/firebase-admin';
import { audienceIntelligenceProfileSchema, defaultAudienceProfile } from './schemas';
import { isIntelligencePhaseEnabled } from './feature-flags';
import type { RequestContext } from '@/lib/server-auth';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature } from '@/lib/stripe/entitlements';
import { buildProductInsights, type InsightSnapshot, type InsightSocialPost, type ProductInsights } from './insights';
import { applyLearningDecisions } from './learnings';
import { applyOpportunityDecisions } from './opportunities';

export function parseAudienceProfile(data: unknown) {
  const parsed = audienceIntelligenceProfileSchema.safeParse(data || {});
  return parsed.success ? parsed.data : defaultAudienceProfile();
}

const AUDIENCE_SNAPSHOT_LIMIT = 400;

/**
 * Computed insights are cached per product. A page load within the TTL costs
 * three small reads (cache doc + the two decision collections) instead of the
 * whole post history plus the bootstrap statistics. Bump the version whenever
 * the shape of `buildProductInsights` output changes.
 */
export const INSIGHTS_CACHE_VERSION = 4;
export const INSIGHTS_CACHE_TTL_MS = 60 * 60_000;
/** Cached rows keep enough caption to preview; the full text lives on the post. */
export const CACHED_CONTENT_LIMIT = 1000;

type StoredDecision = { id: string; status?: string; decidedAt?: string };

type CachedInsightsDoc = {
  cacheVersion?: number;
  computedAt?: string;
  postsCount?: number;
  profile?: unknown;
  insights?: Omit<ProductInsights, 'profile'>;
};

export type LoadedProductIntelligence = {
  profile: ReturnType<typeof parseAudienceProfile>;
  posts: InsightSocialPost[];
  postsCount: number;
  snapshots: InsightSnapshot[];
  storedLearnings: StoredDecision[];
  storedOpportunities: StoredDecision[];
  insights: ProductInsights;
  cached: boolean;
  computedAt: string;
};

/**
 * Recent audience snapshots for the whole workspace. The query is not scoped to
 * a product, so callers loading several products must fetch it once and pass
 * the result to `loadProductIntelligence` — running it per product re-reads the
 * same documents (400 reads each) for no additional data.
 */
export async function loadAudienceSnapshots(workspaceId: string): Promise<InsightSnapshot[]> {
  const snapshot = await adminDb
    .collection(`workspaces/${workspaceId}/audienceSnapshots`)
    .orderBy('date', 'desc')
    .limit(AUDIENCE_SNAPSHOT_LIMIT)
    .get();
  return snapshot.docs.map((doc) => doc.data() as InsightSnapshot);
}

async function loadStoredDecisions(workspaceId: string, productId: string) {
  const [learningsSnap, opportunitiesSnap] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/brandLearnings`).where('productId', '==', productId).limit(100).get(),
    adminDb.collection(`workspaces/${workspaceId}/optimizationRecommendations`).where('productId', '==', productId).limit(100).get(),
  ]);
  return {
    storedLearnings: learningsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as StoredDecision[],
    storedOpportunities: opportunitiesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as StoredDecision[],
  };
}

export function insightsCachePath(workspaceId: string, productId: string): string {
  return `workspaces/${workspaceId}/products/${productId}/intelligence/insights`;
}

export function isInsightsCacheFresh(doc: CachedInsightsDoc | undefined, nowMs = Date.now()): boolean {
  if (!doc || doc.cacheVersion !== INSIGHTS_CACHE_VERSION || !doc.computedAt || !doc.insights) return false;
  const computed = Date.parse(doc.computedAt);
  return Number.isFinite(computed) && nowMs - computed < INSIGHTS_CACHE_TTL_MS;
}

/** Firestore rejects `undefined`; JSON round-trip drops it and freezes class instances into plain data. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function loadProductIntelligence(
  workspaceId: string,
  productId: string,
  options: {
    audienceSnapshots?: InsightSnapshot[];
    /** Serve the cached insights document when it is fresh. */
    allowCached?: boolean;
    /** Write a fresh computation back to the cache (default true). */
    persist?: boolean;
    nowMs?: number;
  } = {},
): Promise<LoadedProductIntelligence> {
  const nowMs = options.nowMs ?? Date.now();
  if (options.allowCached) {
    const [cacheSnap, decisions] = await Promise.all([
      adminDb.doc(insightsCachePath(workspaceId, productId)).get(),
      loadStoredDecisions(workspaceId, productId),
    ]);
    const cachedDoc = cacheSnap.exists ? cacheSnap.data() as CachedInsightsDoc : undefined;
    if (cachedDoc && isInsightsCacheFresh(cachedDoc, nowMs)) {
      const profile = parseAudienceProfile(cachedDoc.profile);
      const cachedInsights = cachedDoc.insights!;
      const insights: ProductInsights = {
        ...cachedInsights,
        profile,
        learnings: applyLearningDecisions(cachedInsights.learnings, decisions.storedLearnings),
        opportunities: applyOpportunityDecisions(cachedInsights.opportunities, decisions.storedOpportunities),
      };
      return {
        profile,
        posts: [],
        postsCount: cachedDoc.postsCount ?? insights.readiness.postsTotal,
        snapshots: [],
        ...decisions,
        insights,
        cached: true,
        computedAt: cachedDoc.computedAt!,
      };
    }
  }

  const [profileSnap, postsSnap, decisions, workspaceSnapshots] = await Promise.all([
    adminDb.doc(`workspaces/${workspaceId}/products/${productId}/intelligence/profile`).get(),
    adminDb.collection(`workspaces/${workspaceId}/socialPosts`).where('productId', '==', productId).limit(1000).get(),
    loadStoredDecisions(workspaceId, productId),
    options.audienceSnapshots ?? loadAudienceSnapshots(workspaceId),
  ]);
  const profile = parseAudienceProfile(profileSnap.exists ? profileSnap.data() : {});
  const posts = postsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as InsightSocialPost[];
  const snapshots = workspaceSnapshots.filter((row) => !row.productId || row.productId === productId);
  const insights = buildProductInsights({
    productId,
    profile,
    posts,
    snapshots,
    storedLearnings: decisions.storedLearnings,
    storedOpportunities: decisions.storedOpportunities,
    nowMs,
    contentLimit: CACHED_CONTENT_LIMIT,
  });
  const computedAt = new Date(nowMs).toISOString();
  if (options.persist !== false) {
    await persistComputedInsights(workspaceId, productId, insights, { postsCount: posts.length, computedAt });
  }
  return {
    profile,
    posts,
    postsCount: posts.length,
    snapshots,
    ...decisions,
    insights,
    cached: false,
    computedAt,
  };
}

export async function intelligencePhaseFlags(ctx: RequestContext) {
  const subscription = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
  const [foundation, learning, growth, experiments, strategist] = await Promise.all([
    isIntelligencePhaseEnabled({ phase: 'foundation', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'audienceFit') }),
    isIntelligencePhaseEnabled({ phase: 'learning', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'intelligenceOptimization') }),
    isIntelligencePhaseEnabled({ phase: 'growth', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'intelligenceOptimization') }),
    isIntelligencePhaseEnabled({ phase: 'advanced', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'intelligenceExperiments') }),
    isIntelligencePhaseEnabled({ phase: 'advanced', workspaceId: ctx.workspaceId, uid: ctx.uid, entitled: hasFeature(subscription, 'intelligenceStrategist') }),
  ]);
  return { foundation, learning, growth, experiments, strategist, advanced: experiments || strategist };
}

export async function persistComputedInsights(
  workspaceId: string,
  productId: string,
  insights: ProductInsights,
  extra: { postsCount?: number; computedAt?: string } = {},
) {
  const batch = adminDb.batch();
  const now = extra.computedAt || new Date().toISOString();
  // Decisions live on the stored document; the recomputed record must never
  // overwrite them, so `status` is stripped before the merge.
  const withoutStatus = <T extends { status?: unknown }>(record: T): Omit<T, 'status'> => {
    const copy: Record<string, unknown> = { ...record };
    delete copy.status;
    return copy as Omit<T, 'status'>;
  };
  for (const learning of insights.learnings) {
    const ref = adminDb.doc(`workspaces/${workspaceId}/brandLearnings/${learning.id}`);
    batch.set(ref, { ...plain(withoutStatus(learning)), workspaceId, updatedAt: now }, { merge: true });
  }
  for (const opportunity of insights.opportunities) {
    const ref = adminDb.doc(`workspaces/${workspaceId}/optimizationRecommendations/${opportunity.id}`);
    batch.set(ref, { ...plain(withoutStatus(opportunity)), workspaceId, updatedAt: now }, { merge: true });
  }
  if (insights.drift) {
    const ref = adminDb.doc(`workspaces/${workspaceId}/audienceDriftEvents/${insights.drift.id}`);
    batch.set(ref, { ...plain(insights.drift), workspaceId, createdAt: now }, { merge: true });
  }
  const alignmentRef = adminDb.doc(`workspaces/${workspaceId}/products/${productId}/intelligence/alignment`);
  batch.set(alignmentRef, { ...plain(insights.alignment), productId, updatedAt: now }, { merge: true });
  const { profile, ...rest } = insights;
  const cacheDoc: CachedInsightsDoc & { productId: string; workspaceId: string; updatedAt: string } = {
    cacheVersion: INSIGHTS_CACHE_VERSION,
    computedAt: now,
    postsCount: extra.postsCount ?? insights.readiness.postsTotal,
    profile: plain(profile),
    insights: plain(rest),
    productId,
    workspaceId,
    updatedAt: now,
  };
  batch.set(adminDb.doc(insightsCachePath(workspaceId, productId)), cacheDoc);
  await batch.commit();
}
