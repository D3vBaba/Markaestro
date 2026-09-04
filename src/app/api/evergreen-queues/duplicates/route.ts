import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { checkCaptionDuplicates } from '@/lib/evergreen/duplicates';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  productId: z.string().trim().min(1).max(200),
  captions: z.array(z.string().max(65000)).min(1).max(20),
});

/** Flags captions identical to something the brand published in the last 60 days. */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const input = schema.parse(await req.json());
    return apiOk({ duplicates: await checkCaptionDuplicates(ctx.workspaceId, input.productId, input.captions) });
  } catch (error) {
    return apiError(error);
  }
}
