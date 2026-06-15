// Connect API: GET /api/connect/v1/social-accounts
// Lists connected, publishable destinations as Connect "social accounts", each
// labeled with the product it belongs to. A product-bound key sees only its own.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { listConnectedAccounts } from '@/lib/public-api/connect-compat';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    const accounts = await listConnectedAccounts(ctx.workspaceId, ctx.productId);
    return Response.json({ data: accounts }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
