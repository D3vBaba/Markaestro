import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getApiClientUsage } from '@/lib/public-api/usage';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const usage = await getApiClientUsage(ctx.workspaceId, 14);
    return apiOk(usage);
  } catch (error) {
    return apiError(error);
  }
}
