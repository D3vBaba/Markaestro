import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { buildApiKey } from '@/lib/public-api/keys';

export const runtime = 'nodejs';


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    // Rotation mints a brand-new credential, so it carries the same
    // verified-email requirement as key creation.
    if (!ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to rotate API keys.' },
        403,
      );
    }
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/api_clients/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const current = snap.data() as {
      name?: string;
      scopes?: string[];
      status?: 'active' | 'revoked';
      createdAt?: string;
      expiresAt?: string | null;
    };
    if (current.status !== 'active') {
      return apiOk(
        { error: 'INVALID_STATUS', message: 'Only active API keys can be rotated.' },
        400,
      );
    }

    // Reuse the existing clientId: the token format embeds it, so the new
    // key parses identically — only the secret (and its hash) changes,
    // which kills the old secret immediately.
    const apiKey = buildApiKey(ctx.workspaceId, id);
    const rotatedAt = new Date().toISOString();

    await ref.set({
      keyPrefix: apiKey.keyPrefix,
      secretHash: apiKey.secretHash,
      rotatedAt,
      // The rotator is the new effective issuer of the credential.
      ownerUid: ctx.uid,
      createdEmailVerified: true,
    }, { merge: true });

    return apiOk({
      apiClient: {
        id,
        name: current.name || '',
        scopes: current.scopes || [],
        status: 'active',
        keyPrefix: apiKey.keyPrefix,
        createdAt: current.createdAt || rotatedAt,
        expiresAt: current.expiresAt ?? null,
        rotatedAt,
      },
      apiKey: apiKey.token,
    });
  } catch (error) {
    return apiError(error);
  }
}
