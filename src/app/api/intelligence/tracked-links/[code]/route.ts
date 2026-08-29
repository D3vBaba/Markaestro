import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { retireTrackedLink, updateTrackedLink } from '@/lib/intelligence/conversions';
import { requireIntelligenceAccess } from '@/lib/intelligence/access';
import { appOrigin, trackedLinkRow } from '@/lib/intelligence/tracked-link-rows';

/**
 * `destination` and `label` are editable; `code`, `productId`, and the
 * counters are not. Repointing a live link is the whole reason this route
 * exists (a campaign URL that moved), but moving it between brands would
 * silently reassign every click already attributed to it.
 */
const patchSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  destination: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
    .optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Send at least one field to update.',
});

async function loadLink(workspaceId: string, code: string) {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/trackedLinks/${code}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  return snap.data() as Record<string, unknown>;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'intelligence.read');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const { code } = await params;
    const data = await loadLink(ctx.workspaceId, code);
    return apiOk({ link: trackedLinkRow(data, appOrigin(req)) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'conversions.manage');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const { code } = await params;
    const input = patchSchema.parse(await req.json());
    const existing = await loadLink(ctx.workspaceId, code);
    // Reactivating a retired link clears the tombstone, so the list does not
    // show a live link that still claims a deletion date.
    const update = input.active === true ? { ...input, deletedAt: null } : input;
    await updateTrackedLink(ctx.workspaceId, code, update, ctx.uid);
    return apiOk({ link: trackedLinkRow({ ...existing, ...update }, appOrigin(req)) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'conversions.manage');
    await requireIntelligenceAccess(ctx, 'learning', 'intelligenceOptimization');
    const { code } = await params;
    await loadLink(ctx.workspaceId, code);
    await retireTrackedLink(ctx.workspaceId, code, ctx.uid);
    // Soft delete: the code keeps resolving to a "retired" page rather than
    // 404ing, and the 90-day attribution window keeps its click history.
    return apiOk({ ok: true, code, active: false });
  } catch (error) {
    return apiError(error);
  }
}
