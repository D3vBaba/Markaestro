import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createOtp } from '@/lib/auth-otp';
import { signInCodeEmail } from '@/lib/auth-emails';
import { sendResendEmail } from '@/lib/resend';
import { pickLocaleFromAcceptLanguage } from '@/i18n/routing';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().email(),
});

/**
 * Request a one-time sign-in code. Public: works for both new and existing
 * accounts (the account is created on verify), so there is nothing to
 * enumerate. Abuse is bounded by the IP rate limit plus the per-email
 * 60s resend cooldown enforced in createOtp.
 */
export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);
    const body = BodySchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const code = await createOtp('sign-in', email);
    // Pre-auth: there's no uid yet (the account may not even exist), so
    // there's no member doc to read a stored locale from — fall back to
    // the browser's own Accept-Language.
    const locale = pickLocaleFromAcceptLanguage(req.headers.get('accept-language'));
    const tpl = await signInCodeEmail({ code, email, locale });
    await sendResendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
