import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';
import { createEmailVerificationLink } from '@/lib/firebase-action-links';
import { verifyEmail } from '@/lib/auth-emails';
import { sendResendEmail } from '@/lib/resend';

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
    const uid = decoded.uid;

    const { email, link } = await createEmailVerificationLink(uid);
    const tpl = verifyEmail({ actionUrl: link, email });
    await sendResendEmail({ to: email, subject: tpl.subject, html: tpl.html });

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}

