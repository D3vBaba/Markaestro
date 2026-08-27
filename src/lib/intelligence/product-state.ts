import { adminDb } from '@/lib/firebase-admin';
import { audienceIntelligenceProfileSchema, defaultAudienceProfile } from './schemas';
import { isIntelligencePhaseEnabled } from './feature-flags';
import type { RequestContext } from '@/lib/server-auth';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { hasFeature } from '@/lib/stripe/entitlements';
import { buildProductInsights, type InsightSnapshot, type InsightSocialPost } from './insights';

export function parseAudienceProfile(data: unknown) {
  const parsed = audienceIntelligenceProfileSchema.safeParse(data || {});
  return parsed.success ? parsed.data : defaultAudienceProfile();
}

const AUDIENCE_SNAPSHOT_LIMIT = 400;

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

export async function loadProductIntelligence(
  workspaceId: string,
  productId: string,
  options: { audienceSnapshots?: InsightSnapshot[] } = {},
) {
  const [profileSnap, postsSnap, learningsSnap, opportunitiesSnap, workspaceSnapshots] = await Promise.all([
    adminDb.doc(`workspaces/${workspaceId}/products/${productId}/intelligence/profile`).get(),
    adminDb.collection(`workspaces/${workspaceId}/socialPosts`).where('productId', '==', productId).limit(1000).get(),
    adminDb.collection(`workspaces/${workspaceId}/brandLearnings`).where('productId', '==', productId).limit(100).get(),
    adminDb.collection(`workspaces/${workspaceId}/optimizationRecommendations`).where('productId', '==', productId).limit(100).get(),
    options.audienceSnapshots ?? loadAudienceSnapshots(workspaceId),
  ]);
  const profile = parseAudienceProfile(profileSnap.exists ? profileSnap.data() : {});
  const posts = postsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as InsightSocialPost[];
  const snapshots = workspaceSnapshots.filter((row) => !row.productId || row.productId === productId);
  const storedLearnings = learningsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const storedOpportunities = opportunitiesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return {
    profile,
    posts,
    snapshots,
    storedLearnings,
    storedOpportunities,
    insights: buildProductInsights({
      productId,
      profile,
      posts,
      snapshots,
      storedLearnings,
      storedOpportunities,
    }),
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
  insights: ReturnType<typeof buildProductInsights>,
) {
  const batch = adminDb.batch();
  const now = new Date().toISOString();
  for (const learning of insights.learnings) {
    const { status: _status, ...rest } = learning;
    const ref = adminDb.doc(`workspaces/${workspaceId}/brandLearnings/${learning.id}`);
    batch.set(ref, { ...rest, workspaceId, updatedAt: now }, { merge: true });
  }
  for (const opportunity of insights.opportunities) {
    const { status: _status, ...rest } = opportunity;
    const ref = adminDb.doc(`workspaces/${workspaceId}/optimizationRecommendations/${opportunity.id}`);
    batch.set(ref, { ...rest, workspaceId, updatedAt: now }, { merge: true });
  }
  if (insights.drift) {
    const ref = adminDb.doc(`workspaces/${workspaceId}/audienceDriftEvents/${insights.drift.id}`);
    batch.set(ref, { ...insights.drift, workspaceId, createdAt: now }, { merge: true });
  }
  const alignmentRef = adminDb.doc(`workspaces/${workspaceId}/products/${productId}/intelligence/alignment`);
  batch.set(alignmentRef, { ...insights.alignment, productId, updatedAt: now }, { merge: true });
  await batch.commit();
}
