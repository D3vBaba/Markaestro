import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';
import { pipelineCadences } from '@/lib/schemas';
import type { PipelineCadence } from '@/lib/schemas';

const scheduleSchema = z.object({
  startDate: z.string().datetime().optional(),
  cadence: z.enum(pipelineCadences).optional(),
  postTimeHourUTC: z.number().int().min(0).max(23).optional(),
});

const CADENCE_DAYS: Record<PipelineCadence, number[]> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  '3x_week': [1, 3, 5],       // Mon, Wed, Fri
  '2x_week': [2, 4],           // Tue, Thu
  weekly: [1],                  // Monday
};

function calculateScheduleDates(
  startDate: Date,
  postCount: number,
  cadence: PipelineCadence,
  postTimeHour: number,
): Date[] {
  const dates: Date[] = [];
  const allowedDays = CADENCE_DAYS[cadence];
  const cursor = new Date(startDate);
  cursor.setUTCHours(postTimeHour, 0, 0, 0);

  while (dates.length < postCount) {
    if (allowedDays.includes(cursor.getUTCDay())) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const body = await req.json();
    const overrides = scheduleSchema.parse(body);

    // Load campaign
    const campaignRef = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new Error('NOT_FOUND');

    const campaign = campaignSnap.data()!;
    if (campaign.type !== 'pipeline') {
      throw new Error('VALIDATION_CAMPAIGN_IS_NOT_PIPELINE_TYPE');
    }

    if (!campaign.pipelineStatus || !['generated', 'scheduled'].includes(campaign.pipelineStatus)) {
      throw new Error('VALIDATION_PIPELINE_MUST_BE_GENERATED_FIRST');
    }

    const pipelineConfig = campaign.pipeline;
    if (!pipelineConfig) throw new Error('VALIDATION_PIPELINE_CONFIG_MISSING');

    const cadence = overrides.cadence || pipelineConfig.cadence || '3x_week';
    const startDate = new Date(overrides.startDate || pipelineConfig.startDate);
    const postTimeHour = overrides.postTimeHourUTC ?? pipelineConfig.postTimeHourUTC ?? 10;

    // Load all draft pipeline posts for this campaign
    const postsSnap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .where('campaignId', '==', id)
      .where('status', '==', 'draft')
      .get();

    if (postsSnap.empty) {
      throw new Error('VALIDATION_NO_DRAFT_POSTS_TO_SCHEDULE');
    }

    // Sort by pipelineSequence
    const posts = postsSnap.docs
      .map((doc) => ({ ref: doc.ref, data: doc.data() }))
      .sort((a, b) => (a.data.pipelineSequence ?? 0) - (b.data.pipelineSequence ?? 0));

    // Calculate schedule dates
    const dates = calculateScheduleDates(startDate, posts.length, cadence, postTimeHour);

    // Batch update all posts
    const now = new Date().toISOString();
    const batch = adminDb.batch();

    for (let i = 0; i < posts.length; i++) {
      batch.update(posts[i].ref, {
        status: 'scheduled',
        scheduledAt: dates[i].toISOString(),
        updatedAt: now,
      });
    }

    await batch.commit();

    // Update campaign status
    await campaignRef.update({
      status: 'scheduled',
      pipelineStatus: 'scheduled',
      updatedAt: now,
    });

    return apiOk({
      campaignId: id,
      scheduledCount: posts.length,
      cadence,
      firstPostAt: dates[0].toISOString(),
      lastPostAt: dates[dates.length - 1].toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
