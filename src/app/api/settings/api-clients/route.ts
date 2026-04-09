import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { buildApiKey } from '@/lib/public-api/keys';
import { createApiClientSchema } from '@/lib/public-api/schemas';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const snap = await adminDb.collection(`workspaces/${ctx.workspaceId}/api_clients`).get();
    return apiOk({
      apiClients: snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          scopes: data.scopes || [],
          status: data.status || 'revoked',
          keyPrefix: data.keyPrefix || '',
          createdAt: data.createdAt,
          lastUsedAt: data.lastUsedAt || null,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const body = await req.json();
    const data = createApiClientSchema.parse(body);
    const clientId = `cli_${crypto.randomUUID()}`;
    const apiKey = buildApiKey(ctx.workspaceId, clientId);
    const createdAt = new Date().toISOString();

    await adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${clientId}`).set({
      name: data.name,
      ownerUid: ctx.uid,
      scopes: data.scopes,
      status: 'active',
      keyPrefix: apiKey.keyPrefix,
      secretHash: apiKey.secretHash,
      createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });

    return apiOk({
      apiClient: {
        id: clientId,
        name: data.name,
        scopes: data.scopes,
        status: 'active',
        keyPrefix: apiKey.keyPrefix,
        createdAt,
      },
      apiKey: apiKey.token,
    }, 201);
  } catch (error) {
    return apiError(error);
  }
}
