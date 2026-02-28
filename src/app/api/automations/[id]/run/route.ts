import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { executeAutomation } from '@/lib/automations/engine';
import { z } from 'zod';

const runSchema = z.object({
  contactId: z.string().trim().min(1, 'contactId is required'),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'automations')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const automation = snap.data()!;
    if (!automation.enabled) throw new Error('VALIDATION_AUTOMATION_DISABLED');

    const body = await req.json();
    const { contactId } = runSchema.parse(body);

    const steps = automation.steps || [];
    if (steps.length === 0) {
      return apiOk({ message: 'Automation has no steps to execute' });
    }

    const result = await executeAutomation(ctx.workspaceId, id, contactId, steps);
    return apiOk({ automationId: id, contactId, ...result });
  } catch (error) {
    return apiError(error);
  }
}
