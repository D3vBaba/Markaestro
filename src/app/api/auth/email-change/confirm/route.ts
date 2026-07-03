import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyOtp } from '@/lib/auth-otp';
import { getBearerFromRequest } from '@/lib/bearer';

export const runtime = 'nodejs';

const BodySchema = z.object({
  newEmail: z.string().email(),
  code: z.string().min(4).max(12),
});

/**
 * Complete an email change: the code sent to the new address proves inbox
 * ownership, so the address is applied already-verified. The client must
 * force-refresh its ID token afterwards to pick up the new email claim.
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

    await verifyOtp(`email-change:${uid}`, newEmail, body.code);
    await adminAuth.updateUser(uid, { email: newEmail, emailVerified: true });

    const resp = apiOk({ ok: true });
    for (const [k, v] of Object.entries(rl.headers)) resp.headers.set(k, v);
    return resp;
  } catch (error) {
    return apiError(error);
  }
}
