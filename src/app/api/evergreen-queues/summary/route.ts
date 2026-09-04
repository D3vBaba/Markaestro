import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getEvergreenProductSummary } from '@/lib/evergreen/summary';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  productId: z.string().trim().min(1).max(200),
  days: z.coerce.number().int().min(7).max(365).default(30),
});

/** What a brand's queues earned in the window, against its fresh posts. */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const params = new URL(req.url).searchParams;
    const input = schema.parse({ productId: params.get('productId') ?? '', days: params.get('days') ?? undefined });
    return apiOk({ summary: await getEvergreenProductSummary(ctx.workspaceId, input.productId, input.days) });
  } catch (error) {
    return apiError(error);
  }
}
