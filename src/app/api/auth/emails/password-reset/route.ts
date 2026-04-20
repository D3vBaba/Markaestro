import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';
import { createPasswordResetLink } from '@/lib/firebase-action-links';
import { passwordResetEmail } from '@/lib/auth-emails';
import { sendResendEmail } from '@/lib/resend';

export const runtime = 'nodejs';


const BodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);
    const body = BodySchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    // Do not leak whether an email exists.
    try {
      const user = await adminAuth.getUserByEmail(email);
      const link = await createPasswordResetLink(email);
      const tpl = passwordResetEmail({ actionUrl: link, email: user.email });
      await sendResendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    } catch (err) {
      // Swallow user-not-found and send failures to avoid enumeration.
      console.warn('[auth/emails/password-reset] suppressed error:', err);
    }

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}

