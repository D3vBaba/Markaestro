/**
 * POST /api/products/[id]/enrich
 *
 * Per-product knowledge enrichment. Looks up the product's URL (or accepts a
 * URL override in the request body), runs AI extraction, persists the result
 * to Firestore, and returns the enriched knowledge for immediate use.
 *
 * Unlike the general POST /api/products/enrich route, this endpoint always
 * persists to the identified product document and uses the product's own URL
 * as the default source.
 */
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { enrichProductKnowledgeFromUrl } from '@/lib/products/enrich';
import { z } from 'zod';

const schema = z.object({
  url: z.string().url().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');

    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const productData = snap.data() ?? {};

    let body: { url?: string } = {};
    try { body = schema.parse(await req.json()); } catch { /* optional body */ }

    const url = body.url || String(productData.url || '');
    if (!url) throw new Error('VALIDATION_ERROR: Product has no URL and none was provided');

    const knowledge = await enrichProductKnowledgeFromUrl(url);

    await ref.update({ knowledge, updatedAt: new Date().toISOString() });

    return apiOk({ id, knowledge });
  } catch (error) {
    return apiError(error);
  }
}
