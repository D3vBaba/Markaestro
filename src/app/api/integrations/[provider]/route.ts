import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { integrationProviders } from '@/lib/schemas';

export const runtime = 'nodejs';


const ALLOWED = new Set(integrationProviders);

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (!ALLOWED.has(provider as typeof integrationProviders[number])) {
      throw new Error('INVALID_PROVIDER');
    }

    return apiOk({
      ok: false,
      provider,
      error: 'Social integrations must be connected through the OAuth flow.',
      authorizeUrl: `/api/oauth/authorize/${provider}`,
    }, 400);
  } catch (error) {
    return apiError(error);
  }
}
