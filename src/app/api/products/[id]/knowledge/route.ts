/**
 * GET  /api/products/[id]/knowledge  — return current knowledge store
 * PATCH /api/products/[id]/knowledge  — merge-update knowledge fields
 *
 * The PATCH handler accepts a partial ProductKnowledge object and deep-merges
 * it into the existing knowledge store. Arrays fully replace their counterpart
 * (no array merging) to keep the semantics simple. Sets enrichmentSource to
 * 'manual' and updates lastEnrichedAt.
 */
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { productKnowledgeSchema } from '@/lib/schemas';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const data = snap.data() ?? {};
    return apiOk({ id, knowledge: data.knowledge ?? null });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');

    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const body = await req.json();
    // Parse as partial — unknown keys are stripped, defaults fill gaps
    const incoming = productKnowledgeSchema.partial().parse(body);

    const existing = (snap.data() ?? {}).knowledge ?? {};
    const updated = {
      ...existing,
      ...incoming,
      enrichmentSource: 'manual' as const,
      lastEnrichedAt: new Date().toISOString(),
    };

    await ref.update({ knowledge: updated, updatedAt: new Date().toISOString() });

    return apiOk({ id, knowledge: updated });
  } catch (error) {
    return apiError(error);
  }
}
