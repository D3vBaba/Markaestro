import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import type { PipelineStage } from '@/lib/schemas';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    // Load campaign
    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }

    const activeRunId = (campaign.activeRunId || campaign.latestRunId) as string | undefined;
    const postsQuery = activeRunId
      ? adminDb
          .collection(`workspaces/${ctx.workspaceId}/posts`)
          .where('campaignId', '==', id)
          .where('generationRunId', '==', activeRunId)
      : adminDb
          .collection(`workspaces/${ctx.workspaceId}/posts`)
          .where('campaignId', '==', id);
    const postsSnap = await postsQuery.get();

    const posts = postsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => ((a as Record<string, unknown>).pipelineSequence as number ?? 0) - ((b as Record<string, unknown>).pipelineSequence as number ?? 0));

    // Group posts by stage
    const stages: Record<string, Array<Record<string, unknown>>> = {};
    for (const post of posts) {
      const stage = (post as Record<string, unknown>).pipelineStage as PipelineStage || 'awareness';
      if (!stages[stage]) stages[stage] = [];
      stages[stage].push(post);
    }

    // Compute stats
    const statusCounts: Record<string, number> = {};
    for (const post of posts) {
      const status = (post as Record<string, unknown>).status as string || 'draft';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    return apiOk({
      campaignId: id,
      campaignName: campaign.name,
      pipelineStatus: campaign.pipelineStatus || null,
      pipelineConfig: campaign.pipeline || null,
      researchBrief: campaign.researchBrief || null,
      configDirty: Boolean(campaign.configDirty),
      configDirtyReason: campaign.configDirtyReason || null,
      activeRunId: activeRunId || null,
      latestRunId: campaign.latestRunId || null,
      scheduledRunId: campaign.scheduledRunId || null,
      stages,
      totalPosts: posts.length,
      statusCounts,
    });
  } catch (error) {
    return apiError(error);
  }
}
