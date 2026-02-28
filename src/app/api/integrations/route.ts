import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/integrations`)
      .get();

    // Mask sensitive fields before returning
    const items = snap.docs.map((d) => {
      const data = d.data();
      return {
        provider: d.id,
        enabled: data.enabled ?? false,
        status: data.status ?? 'disconnected',
        updatedAt: data.updatedAt,
        // Never return API keys or tokens
        hasApiKey: Boolean(data.apiKeyEncrypted || data.apiKey),
        hasAccessToken: Boolean(data.accessTokenEncrypted || data.accessToken),
        fromEmail: data.fromEmail,
        adAccountId: data.adAccountId,
        pageId: data.pageId,
        igAccountId: data.igAccountId,
      };
    });

    return apiOk({ workspaceId: ctx.workspaceId, integrations: items });
  } catch (error) {
    return apiError(error);
  }
}
