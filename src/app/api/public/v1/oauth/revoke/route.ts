/**
 * Token revocation (RFC 7009). An MCP client calls this when the user
 * disconnects it, so the key it held stops working immediately rather than
 * at expiry. The token itself is the credential; the response is 200
 * whether or not the token existed, as the RFC requires.
 */
import { NextResponse } from 'next/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { publicApiError } from '@/lib/public-api/response';
import { OAuthError, oauthErrorResponse } from '@/lib/agent-oauth/errors';
import { readTokenRequest, revokeToken } from '@/lib/agent-oauth/grants';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    await applyRateLimit(req, RATE_LIMITS.auth);
    const body = await readTokenRequest(req);
    const token = body.token?.trim();
    if (!token) throw new OAuthError('invalid_request', 'token is required.');
    await revokeToken(token);
    const res = new NextResponse(null, { status: 200 });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    return oauthErrorResponse(error, publicApiError);
  }
}
