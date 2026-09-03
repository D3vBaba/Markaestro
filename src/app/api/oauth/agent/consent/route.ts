/**
 * The Allow button on the consent page. Verifies everything that minting a
 * key requires (workspace admin, verified email, active subscription, the
 * brand exists, the client and redirect URI are registered) and issues a
 * single-use authorization code carrying those verified facts. The token
 * endpoint turns the code into an API key without re-checking them.
 */
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getEffectiveSubscription, isActiveSubscription } from '@/lib/stripe/subscription';
import { publicApiScopes } from '@/lib/public-api/scopes';
import { getOAuthClient, createAuthorizationCode } from '@/lib/agent-oauth/store';
import { redirectUriMatches } from '@/lib/agent-oauth/redirect-uri';
import { isValidCodeChallenge } from '@/lib/agent-oauth/pkce';

export const runtime = 'nodejs';

const consentSchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().min(1).max(2048),
  codeChallenge: z.string().min(1).max(200),
  codeChallengeMethod: z.literal('S256'),
  state: z.string().max(2048).optional(),
  productId: z.string().min(1).max(200),
  scopes: z.array(z.enum(publicApiScopes)).min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    await applyRateLimit(req, RATE_LIMITS.auth, { key: ctx.uid });

    if (!ctx.emailVerified) {
      return apiOk({ error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before connecting an agent.' }, 403);
    }
    const subscription = await getEffectiveSubscription({ uid: ctx.uid, workspaceId: ctx.workspaceId });
    if (!isActiveSubscription(subscription)) {
      return apiOk(
        { error: 'SUBSCRIPTION_REQUIRED', message: 'An active subscription is required to connect an agent.' },
        402,
      );
    }

    const data = consentSchema.parse(await req.json());
    if (!isValidCodeChallenge(data.codeChallenge)) {
      return apiOk({ error: 'OAUTH_INVALID_CODE_CHALLENGE', message: 'The agent sent an invalid PKCE challenge.' }, 400);
    }

    const client = await getOAuthClient(data.clientId);
    if (!client) {
      return apiOk({ error: 'OAUTH_CLIENT_NOT_FOUND', message: 'Unknown client. Ask the agent to reconnect.' }, 404);
    }
    if (!client.redirectUris.some((registered) => redirectUriMatches(registered, data.redirectUri))) {
      return apiOk({ error: 'OAUTH_REDIRECT_URI_MISMATCH', message: 'The redirect address is not registered for this client.' }, 400);
    }

    const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`).get();
    if (!productSnap.exists) {
      return apiOk({ error: 'PRODUCT_NOT_FOUND', message: 'Selected brand does not exist.' }, 404);
    }

    const code = await createAuthorizationCode({
      clientId: data.clientId,
      redirectUri: data.redirectUri,
      codeChallenge: data.codeChallenge,
      scopes: Array.from(new Set(data.scopes)),
      workspaceId: ctx.workspaceId,
      productId: data.productId,
      uid: ctx.uid,
      clientName: client.clientName,
    });

    const redirect = new URL(data.redirectUri);
    redirect.searchParams.set('code', code);
    if (data.state) redirect.searchParams.set('state', data.state);
    return apiOk({ redirectTo: redirect.toString() });
  } catch (error) {
    return apiError(error);
  }
}
