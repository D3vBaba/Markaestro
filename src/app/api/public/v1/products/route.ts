import { requirePublicApiContext } from '@/lib/public-api/auth';
import { listPublicProducts } from '@/lib/public-api/products';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';


const PRODUCTS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'products.read',
      rateLimit: PRODUCTS_RATE_LIMIT,
    });

    const products = await listPublicProducts(ctx.workspaceId);
    return Response.json({ products, count: products.length }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
