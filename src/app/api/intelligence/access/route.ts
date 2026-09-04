import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { canAccessIntelligencePreviewAsync } from '@/lib/intelligence/preview-access-server';

export const runtime = 'nodejs';

/**
 * Whether the signed-in user is on the Intelligence private-preview
 * allowlist. The client can only see the build-time half of that list, so the
 * sidebar and the Intelligence page ask here for the server half
 * (`_featureFlags/intelligencePreview`) before deciding what to show.
 */
export async function GET(req: Request) {
  try {
    await applyRateLimit(req, RATE_LIMITS.api);
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const canAccess = await canAccessIntelligencePreviewAsync({ email: ctx.email, uid: ctx.uid });
    return apiOk({ canAccess });
  } catch (error) {
    return apiError(error);
  }
}
