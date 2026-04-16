import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { metaIntegrationSchema, integrationProviders } from '@/lib/schemas';
import { encrypt } from '@/lib/crypto';
import { saveConnection } from '@/lib/platform/connections';
import { ConnectionStatus } from '@/lib/platform/types';

const ALLOWED = new Set(integrationProviders);
const PRODUCT_LEVEL_PROVIDERS = new Set(['meta', 'tiktok', 'facebook', 'instagram']);

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (!ALLOWED.has(provider as typeof integrationProviders[number])) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json();
    const productId = body.productId as string | undefined;

    if (PRODUCT_LEVEL_PROVIDERS.has(provider) && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }

    const metadata: Record<string, unknown> = {};
    let accessTokenEncrypted = '';

    if (provider === 'facebook' || provider === 'instagram' || provider === 'meta') {
      const data = metaIntegrationSchema.parse(body);
      accessTokenEncrypted = encrypt(data.accessToken);
      if (data.pageId) metadata.pageId = data.pageId;
      if (data.igAccountId) metadata.igAccountId = data.igAccountId;
    } else {
      const data = metaIntegrationSchema.parse(body);
      accessTokenEncrypted = encrypt(data.accessToken);
    }

    await saveConnection(ctx.workspaceId, provider, {
      provider,
      channels: [],
      capabilities: [],
      status: ConnectionStatus.CONNECTED,
      accessTokenEncrypted,
      metadata,
      updatedBy: ctx.uid,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }, productId);

    return apiOk({ ok: true, provider, status: 'connected' });
  } catch (error) {
    return apiError(error);
  }
}
