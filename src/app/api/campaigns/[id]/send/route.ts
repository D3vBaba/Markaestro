import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { sendCampaignEmails } from '@/lib/email/sender';
import { z } from 'zod';

const sendSchema = z.object({
  testMode: z.boolean().default(false),
  testEmail: z.string().email().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'campaigns')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = snap.data()!;
    if (campaign.channel !== 'email') {
      throw new Error('VALIDATION_ONLY_EMAIL_CAMPAIGNS_SUPPORTED');
    }

    const body = await req.json();
    const { testMode, testEmail } = sendSchema.parse(body);

    const result = await sendCampaignEmails(
      ctx.workspaceId,
      {
        name: campaign.name,
        subject: campaign.subject,
        body: campaign.body,
        cta: campaign.cta,
        targetAudience: campaign.targetAudience,
      },
      { testMode, testEmail },
    );

    // Update campaign status
    if (!testMode && result.sent > 0) {
      await ref.update({
        status: 'active',
        lastSentAt: new Date().toISOString(),
        lastSentCount: result.sent,
        updatedAt: new Date().toISOString(),
      });
    }

    return apiOk({
      campaignId: id,
      ...result,
    });
  } catch (error) {
    return apiError(error);
  }
}
