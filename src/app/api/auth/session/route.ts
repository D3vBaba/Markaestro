import { adminAuth } from '@/lib/firebase-admin';
import { createSessionCookie, SESSION_COOKIE_MAX_AGE } from '@/lib/session-cookie';
import { apiError, apiOk } from '@/lib/api-response';

export const runtime = 'nodejs';


/**
 * POST /api/auth/session — Set a signed HttpOnly session cookie.
 * Body: { idToken: string }
 *
 * DELETE /api/auth/session — Clear the session cookie.
 */
export async function POST(req: Request) {
  try {
    const { idToken } = await req.json();
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('VALIDATION_MISSING_ID_TOKEN');
    }

    // Verify the Firebase ID token server-side
    const decoded = await adminAuth.verifyIdToken(idToken);

    const cookieValue = await createSessionCookie(decoded.uid);

    const response = apiOk({ ok: true });
    response.headers.set(
      'Set-Cookie',
      `__session=${cookieValue}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const response = apiOk({ ok: true });
  response.headers.set(
    'Set-Cookie',
    '__session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  );
  return response;
}
