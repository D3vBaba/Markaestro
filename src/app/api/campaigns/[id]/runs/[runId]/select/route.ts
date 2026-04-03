import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const ctx = await requireContext(req);
    const { id, runId } = await params;

    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }

    const runRef = campaignRef.collection('runs').doc(runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) throw new Error('NOT_FOUND');

    const run = runSnap.data()!;
    if (!['ready', 'scheduled', 'superseded'].includes(run.status)) {
      throw new Error('VALIDATION_RUN_IS_NOT_SELECTABLE');
    }

    const now = new Date().toISOString();
    await campaignRef.update({
      activeRunId: runId,
      latestRunId: campaign.latestRunId || runId,
      updatedAt: now,
    });

    return apiOk({
      campaignId: id,
      runId,
      status: run.status,
      scheduledRunId: campaign.scheduledRunId || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
