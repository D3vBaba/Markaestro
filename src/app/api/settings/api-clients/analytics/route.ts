import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getApiClientAnalytics } from '@/lib/public-api/analytics';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const analytics = await getApiClientAnalytics(ctx.workspaceId, 14);
    return apiOk(analytics);
  } catch (error) {
    return apiError(error);
  }
}
