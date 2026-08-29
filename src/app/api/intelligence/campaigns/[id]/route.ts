import { apiError, apiOk, ApiValidationError } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { campaignSchema } from '@/lib/intelligence/management-schemas';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Collections that carry a `campaignId` back to this campaign. Deleting a
 * referenced campaign would orphan attribution: a tracked link's click and
 * conversion records keep pointing at a campaign that no longer exists, and
 * the 90-day attribution window means those rows outlive the delete by months.
 */
const REFERENCING_COLLECTIONS = [
  { collection: 'trackedLinks', label: 'tracked link' },
  { collection: 'socialPosts', label: 'post' },
] as const;

async function countCampaignReferences(workspaceId: string, campaignId: string) {
  const counts = await Promise.all(
    REFERENCING_COLLECTIONS.map(async ({ collection, label }) => {
      const snapshot = await adminDb
        .collection(`workspaces/${workspaceId}/${collection}`)
        .where('campaignId', '==', campaignId)
        .count()
        .get();
      return { label, count: snapshot.data().count };
    }),
  );
  return counts.filter((entry) => entry.count > 0);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const { id } = await params;
    const snap = await adminDb.doc(`workspaces/${ctx.workspaceId}/campaigns/${id}`).get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    return apiOk({ campaign: { id: snap.id, ...snap.data() } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req); requirePermission(ctx, 'intelligence.manage'); await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const { id } = await params; const input = campaignSchema.parse(await req.json());
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/campaigns/${id}`);
    if (!(await ref.get()).exists) throw new Error('NOT_FOUND');
    await ref.set({ ...input, updatedAt: new Date().toISOString(), updatedBy: ctx.uid }, { merge: true });
    return apiOk({ id, campaign: input });
  } catch (error) { return apiError(error); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.manage');
    await requireIntelligenceAccess(ctx, 'growth', 'intelligenceOptimization');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/campaigns/${id}`);
    if (!(await ref.get()).exists) throw new Error('NOT_FOUND');

    // Refuse rather than orphan. The message names what is still attached so
    // the user knows what to detach first, instead of getting a bare refusal.
    const references = await countCampaignReferences(ctx.workspaceId, id);
    if (references.length > 0) {
      const summary = references
        .map(({ label, count }) => `${count} ${label}${count === 1 ? '' : 's'}`)
        .join(' and ');
      throw new ApiValidationError(
        'VALIDATION_CAMPAIGN_HAS_REFERENCES',
        `This campaign is still used by ${summary}. Detach them before deleting it.`,
        { campaignId: id, references },
      );
    }

    await ref.delete();
    logger.info('campaign deleted via API', {
      event: 'intelligence.campaigns.delete_api',
      workspaceId: ctx.workspaceId,
      uid: ctx.uid,
      campaignId: id,
    });
    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
