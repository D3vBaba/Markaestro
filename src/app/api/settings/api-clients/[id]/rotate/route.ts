import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { buildApiKey } from '@/lib/public-api/keys';
import { invalidateApiClientAuthCache } from '@/lib/public-api/auth';

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
      mode?: string | null;
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
    // Rotation must not change the mode: a test key that came back live would
    // start publishing to real accounts on the next call, which is the one
    // surprise this feature exists to prevent.
    const mode = current.mode === 'test' ? 'test' : 'live';
    const apiKey = buildApiKey(ctx.workspaceId, id, mode);
    const rotatedAt = new Date().toISOString();

    await ref.set({
      keyPrefix: apiKey.keyPrefix,
      secretHash: apiKey.secretHash,
      rotatedAt,
      mode,
      // The rotator is the new effective issuer of the credential.
      ownerUid: ctx.uid,
      createdEmailVerified: true,
    }, { merge: true });
    invalidateApiClientAuthCache(ref.path);

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
        mode,
      },
      apiKey: apiKey.token,
    });
  } catch (error) {
    return apiError(error);
  }
}
