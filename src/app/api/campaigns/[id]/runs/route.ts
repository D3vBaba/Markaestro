import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }

    const runsSnap = await campaignRef.collection('runs').orderBy('createdAt', 'desc').get();
    const runs = runsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      isActive: campaign.activeRunId === doc.id,
      isScheduled: campaign.scheduledRunId === doc.id,
    }));

    return apiOk({ campaignId: id, runs });
  } catch (error) {
    return apiError(error);
  }
}
