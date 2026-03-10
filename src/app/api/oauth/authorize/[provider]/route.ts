import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { generateAuthUrl } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';

const ALLOWED = new Set<string>(oauthProviders);
const SOCIAL_PROVIDERS = new Set(['meta', 'x', 'tiktok']);

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    // Social providers require a productId (per-product integrations)
    if (SOCIAL_PROVIDERS.has(provider) && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }

    const authUrl = await generateAuthUrl(
      provider as OAuthProvider,
      ctx.workspaceId,
      ctx.uid,
      productId,
    );

    return apiOk({ authUrl });
  } catch (error) {
    return apiError(error);
  }
}
