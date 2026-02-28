import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { resendIntegrationSchema, metaIntegrationSchema, integrationProviders } from '@/lib/schemas';
import { encrypt } from '@/lib/crypto';

const ALLOWED = new Set(integrationProviders);

function buildPayload(provider: string, body: unknown) {
  if (provider === 'resend') {
    const data = resendIntegrationSchema.parse(body);
    return {
      fromEmail: data.fromEmail,
      apiKeyEncrypted: encrypt(data.apiKey),
      enabled: data.enabled,
    };
  }
  if (provider === 'facebook' || provider === 'instagram') {
    const data = metaIntegrationSchema.parse(body);
    return {
      accessTokenEncrypted: encrypt(data.accessToken),
      adAccountId: data.adAccountId,
      pageId: data.pageId,
      igAccountId: data.igAccountId,
      enabled: data.enabled,
    };
  }
  // X and others: coming soon
  return { enabled: false, comingSoon: true };
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx); // Only admins+ can configure integrations

    const { provider } = await params;
    if (!ALLOWED.has(provider as typeof integrationProviders[number])) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json();
    const sanitized = buildPayload(provider, body);

    const payload = {
      provider,
      ...sanitized,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
      status: provider === 'x' ? 'coming_soon' : 'connected',
    };

    await adminDb
      .doc(`workspaces/${ctx.workspaceId}/integrations/${provider}`)
      .set(payload, { merge: true });

    // Return without sensitive fields
    const { apiKeyEncrypted, accessTokenEncrypted, ...safe } = payload as Record<string, unknown>;
    return apiOk({ ok: true, ...safe });
  } catch (error) {
    return apiError(error);
  }
}
