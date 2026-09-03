import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { previewEvergreenQueue } from '@/lib/evergreen/storage';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({ sourcePostId: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `evergreen:${ctx.uid}:${ctx.workspaceId}` });
    requirePermission(ctx, 'evergreen.read');
    const input = schema.parse(await req.json());
    return apiOk(await previewEvergreenQueue(ctx.workspaceId, input.sourcePostId));
  } catch (error) {
    return apiError(error);
  }
}
