import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);
    const token = getBearerToken(req);
    if (!token) throw new Error('UNAUTHENTICATED');

    const decoded = await adminAuth.verifyIdToken(token);
    await adminAuth.revokeRefreshTokens(decoded.uid);

    const resp = apiOk({ ok: true });
    resp.headers.set(
      'Set-Cookie',
      '__session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}

