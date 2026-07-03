import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyOtp } from '@/lib/auth-otp';

export const runtime = 'nodejs';

const BodySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
});

/**
 * Verify a one-time sign-in code and return a Firebase custom token.
 * A correct code proves inbox ownership, so the account is created on the
 * fly for new users and emailVerified is set unconditionally — this is what
 * replaces the separate email-verification flow.
 */
export async function POST(req: Request) {
  try {
    const rl = await applyRateLimit(req, RATE_LIMITS.auth);
    const body = BodySchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    await verifyOtp('sign-in', email, body.code);

    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch {
      user = await adminAuth.createUser({ email, emailVerified: true });
    }
    if (user.disabled) throw new Error('USER_DISABLED');
    if (!user.emailVerified) {
      await adminAuth.updateUser(user.uid, { emailVerified: true });
    }

    const token = await adminAuth.createCustomToken(user.uid);

    const resp = apiOk({ token });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
