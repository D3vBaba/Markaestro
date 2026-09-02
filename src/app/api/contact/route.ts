import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { escapeHtml } from '@/lib/auth-emails';
import { sendResendEmail } from '@/lib/resend';

export const runtime = 'nodejs';

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
});

const SUPPORT_INBOX = 'support@markaestro.com';

/**
 * Public contact form. Delivers the message to the support inbox with the
 * sender as reply-to, so support can answer from their mail client. Bounded
 * by the same IP rate limit as sign-in requests.
 */
export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);
    const body = BodySchema.parse(await req.json());

    const text = `From: ${body.name} <${body.email}>\n\n${body.message}`;
    const html = `<p><strong>From:</strong> ${escapeHtml(body.name)} &lt;${escapeHtml(body.email)}&gt;</p>
<p style="white-space:pre-wrap">${escapeHtml(body.message)}</p>`;

    await sendResendEmail({
      to: SUPPORT_INBOX,
      subject: `[Contact] ${body.subject}`,
      html,
      text,
      replyTo: body.email,
    });

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
