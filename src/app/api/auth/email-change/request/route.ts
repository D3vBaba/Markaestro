import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';
import { createOtp } from '@/lib/auth-otp';
import { emailChangeCodeEmail, emailChangeNotice } from '@/lib/auth-emails';
import { sendResendEmail } from '@/lib/resend';
import { getBearerFromRequest } from '@/lib/bearer';

export const runtime = 'nodejs';

const BodySchema = z.object({
  newEmail: z.string().email(),
});

/**
 * Start an email change: sends a one-time code to the NEW address and a
 * heads-up notice to the current one. The change is applied by /confirm
 * once the code proves ownership of the new inbox.
 */
export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);

    const token = getBearerFromRequest(req);
    if (!token) throw new Error('UNAUTHENTICATED');
    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;

    const body = BodySchema.parse(await req.json());
    const newEmail = body.newEmail.trim().toLowerCase();

    const taken = await adminAuth
      .getUserByEmail(newEmail)
      .then((u) => u.uid !== uid)
      .catch(() => false);
    if (taken) throw new Error('EMAIL_IN_USE');

    const code = await createOtp(`email-change:${uid}`, newEmail);
    const tpl = emailChangeCodeEmail({ code, newEmail });
    await sendResendEmail({ to: newEmail, subject: tpl.subject, html: tpl.html, text: tpl.text });

    const user = await adminAuth.getUser(uid);
    const oldEmail = (user.email || '').trim().toLowerCase();
    if (oldEmail && oldEmail !== newEmail) {
      const notice = emailChangeNotice({ oldEmail, newEmail });
      await sendResendEmail({ to: oldEmail, subject: notice.subject, html: notice.html, text: notice.text }).catch((err) => {
        console.warn('[auth/email-change/request] failed sending notice to old email:', err);
      });
    }

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
