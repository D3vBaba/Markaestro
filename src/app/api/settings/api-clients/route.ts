import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { buildApiKey } from '@/lib/public-api/keys';
import { createApiClientSchema } from '@/lib/public-api/schemas';

export const runtime = 'nodejs';


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
          archived: data.archived === true,
          keyPrefix: data.keyPrefix || '',
          createdAt: data.createdAt,
          expiresAt: data.expiresAt || null,
          lastUsedAt: data.lastUsedAt || null,
          productId: data.productId || null,
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
    // API keys can publish via the public API, which has no per-user
    // verification concept — so key creation itself requires a verified email.
    if (!ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to create API keys.' },
        403,
      );
    }
    const body = await req.json();
    const data = createApiClientSchema.parse(body);

    // Every key is bound to a product — validate it exists before minting.
    const productSnap = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`)
      .get();
    if (!productSnap.exists) {
      return apiOk({ error: 'PRODUCT_NOT_FOUND', message: 'Selected product does not exist.' }, 404);
    }

    const clientId = `cli_${crypto.randomUUID()}`;
    const apiKey = buildApiKey(ctx.workspaceId, clientId);
    const createdAt = new Date().toISOString();
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${clientId}`).set({
      name: data.name,
      ownerUid: ctx.uid,
      scopes: data.scopes,
      status: 'active',
      archived: false,
      keyPrefix: apiKey.keyPrefix,
      secretHash: apiKey.secretHash,
      createdAt,
      expiresAt,
      // Optional product binding (null = workspace-wide).
      productId: data.productId || null,
      // Provenance snapshot: the issuer's email was verified at issuance time.
      createdEmailVerified: true,
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
        expiresAt,
        productId: data.productId || null,
      },
      apiKey: apiKey.token,
    }, 201);
  } catch (error) {
    return apiError(error);
  }
}
