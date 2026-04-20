/**
 * POST /api/products/enrich
 *
 * Deep knowledge extraction for a product. Takes a URL and returns a
 * structured ProductKnowledge object. If `productId` is provided the result
 * is written directly to Firestore.
 *
 * For per-product enrichment (using the product's own URL), prefer the
 * dedicated POST /api/products/[id]/enrich endpoint.
 */
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { enrichProductKnowledgeFromUrl } from '@/lib/products/enrich';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  url: z.string().url(),
  productId: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    await applyRateLimit(req, RATE_LIMITS.ai, {
      key: `product-enrich:${ctx.uid}:${ctx.workspaceId}`,
    });

    const body = await req.json();
    const { url, productId } = schema.parse(body);

    const knowledge = await enrichProductKnowledgeFromUrl(url);

    if (productId) {
      await adminDb
        .doc(`workspaces/${ctx.workspaceId}/products/${productId}`)
        .update({ knowledge, updatedAt: new Date().toISOString() });
    }

    return apiOk({ knowledge });
  } catch (error) {
    return apiError(error);
  }
}
