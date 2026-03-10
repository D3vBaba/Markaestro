import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { resendIntegrationSchema, metaIntegrationSchema, integrationProviders } from '@/lib/schemas';
import { encrypt } from '@/lib/crypto';

const ALLOWED = new Set(integrationProviders);
const PRODUCT_LEVEL_PROVIDERS = new Set(['meta', 'x', 'tiktok', 'facebook', 'instagram', 'resend']);

function buildPayload(provider: string, body: unknown) {
  if (provider === 'resend') {
    const data = resendIntegrationSchema.parse(body);
    return {
      fromEmail: data.fromEmail,
      apiKeyEncrypted: encrypt(data.apiKey),
      enabled: data.enabled,
    };
  }
  if (provider === 'facebook' || provider === 'instagram' || provider === 'meta') {
    const data = metaIntegrationSchema.parse(body);
    return {
      accessTokenEncrypted: encrypt(data.accessToken),
      adAccountId: data.adAccountId,
      pageId: data.pageId,
      igAccountId: data.igAccountId,
      enabled: data.enabled,
    };
  }
  if (provider === 'x' || provider === 'google' || provider === 'tiktok') {
    // These are set up via OAuth; allow manual entry as fallback
    const data = metaIntegrationSchema.parse(body);
    return {
      accessTokenEncrypted: encrypt(data.accessToken),
      enabled: data.enabled,
    };
  }
  return { enabled: false };
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const { provider } = await params;
    if (!ALLOWED.has(provider as typeof integrationProviders[number])) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json();
    const productId = body.productId as string | undefined;

    // Social providers require productId (per-product)
    if (PRODUCT_LEVEL_PROVIDERS.has(provider) && !productId) {
      throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    }

    const sanitized = buildPayload(provider, body);

    const payload = {
      provider,
      ...sanitized,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
      status: 'connected',
    };

    const docPath = productId
      ? `workspaces/${ctx.workspaceId}/products/${productId}/integrations/${provider}`
      : `workspaces/${ctx.workspaceId}/integrations/${provider}`;

    await adminDb.doc(docPath).set(payload, { merge: true });

    // Return without sensitive fields
    const {
      apiKeyEncrypted, apiKeySecretEncrypted,
      accessTokenEncrypted, accessTokenSecretEncrypted,
      ...safe
    } = payload as Record<string, unknown>;
    return apiOk({ ok: true, ...safe });
  } catch (error) {
    return apiError(error);
  }
}
