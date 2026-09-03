/**
 * POST /api/products/[id]/knowledge/import
 *
 * Reads the brand's website through Cloudflare Browser Rendering and fills
 * the product knowledge store from it. Fields the workspace already wrote are
 * kept unless `overwrite` is set. Charged as one AI operation, refunded if
 * the import fails.
 */
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';
import { withAiOperation } from '@/lib/intelligence/usage';
import { importKnowledgeFromSite, mergeImportedKnowledge } from '@/lib/products/knowledge-import';

export const runtime = 'nodejs';

const bodySchema = z.object({
  url: z.string().trim().max(2048).optional(),
  overwrite: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'products.write');
    // Each import renders several pages and holds a model call open.
    await applyRateLimit(req, RATE_LIMITS.strategist, { key: `knowledge-import:${ctx.workspaceId}` });

    const { id } = await params;
    const ref = adminDb.doc(`${workspaceCollection(ctx.workspaceId, 'products')}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const product = snap.data() ?? {};

    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const rawUrl = body.url || (typeof product.url === 'string' ? product.url : '');
    if (!rawUrl) throw new Error('VALIDATION_KNOWLEDGE_IMPORT_NO_URL');
    const home = await assertSafeOutboundUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);

    const limits = await getEffectiveLimits(ctx.uid, ctx.workspaceId);
    const result = await withAiOperation(
      { workspaceId: ctx.workspaceId, uid: ctx.uid, monthlyLimit: limits.intelligenceAiOperationsPerMonth },
      () => importKnowledgeFromSite(home),
    );

    const existing = (product.knowledge ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const knowledge = {
      ...mergeImportedKnowledge(existing, result.knowledge, body.overwrite),
      enrichmentSource: 'url_import' as const,
      lastEnrichedAt: now,
    };
    await ref.update({ knowledge, updatedAt: now });

    return apiOk({ id, knowledge, pages: result.pages });
  } catch (error) {
    return apiError(error);
  }
}
