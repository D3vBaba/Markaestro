// Connect API: GET /api/connect/v1/products
// Lists the workspace's products, each with its connected accounts nested — a
// product-first picker for clients that want to scope by product. A
// product-bound key returns only its own product.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { listConnectProducts } from '@/lib/public-api/connect-compat';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    const products = await listConnectProducts(ctx.workspaceId, ctx.productId);
    return Response.json({ data: products }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
