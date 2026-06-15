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

/**
 * Cookie `Domain` attribute so the session is shared across the marketing apex
 * and the app subdomain (e.g. markaestro.com + app.markaestro.com). Without it
 * the cookie is host-only and does not carry across the apex↔subdomain split —
 * which leaves mobile sign-in (whose OAuth bounces through the apex authDomain)
 * stuck at /login. Returns "" (host-only) on localhost / preview / *.hosted.app
 * hosts that are not under the marketing domain.
 */
function cookieDomainAttr(req: Request): string {
  const host = (
    req.headers.get('x-mk-host') ||
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  ).split(':')[0].toLowerCase();

  let base = '';
  try {
    base = process.env.NEXT_PUBLIC_MARKETING_URL
      ? new URL(process.env.NEXT_PUBLIC_MARKETING_URL).hostname.toLowerCase()
      : '';
  } catch {
    base = '';
  }

  if (base && (host === base || host.endsWith(`.${base}`))) {
    return `; Domain=.${base}`;
  }
  return '';
}

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
      `__session=${cookieValue}; Path=/${cookieDomainAttr(req)}; Max-Age=${SESSION_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request) {
  const response = apiOk({ ok: true });
  response.headers.set(
    'Set-Cookie',
    `__session=; Path=/${cookieDomainAttr(req)}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
}
