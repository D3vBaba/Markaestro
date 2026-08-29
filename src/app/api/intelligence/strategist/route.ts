import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiCreated, apiError } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { askStrategist } from '@/lib/intelligence/strategist';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';

const schema = z.object({ productId: z.string().min(1).max(128), question: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req); requirePermission(ctx, 'intelligence.analyze');
    await requireIntelligenceAccess(ctx, 'advanced', 'intelligenceStrategist');
    const input = schema.parse(await req.json());
    if (!(await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${input.productId}`).get()).exists) throw new Error('NOT_FOUND');
    const limits = await getEffectiveLimits(ctx.uid, ctx.workspaceId);
    // The turn is charged before the model call and given back if it fails.
    // A Vertex 503 used to cost the customer a turn they got no answer for.
    const result = await withAiOperation(
      { workspaceId: ctx.workspaceId, uid: ctx.uid, monthlyLimit: limits.strategistTurnsPerMonth, kind: 'strategist' },
      () => askStrategist({ workspaceId: ctx.workspaceId, ...input }),
    );
    const id = randomUUID(); const now = new Date().toISOString();
    await adminDb.doc(`workspaces/${ctx.workspaceId}/strategistConversations/${id}`).set({ id, productId: input.productId, question: input.question, ...result, createdBy: ctx.uid, createdAt: now });
    return apiCreated({ id, ...result });
  } catch (error) { return apiError(error); }
}
