import { requirePublicApiContext } from '@/lib/public-api/auth';
import { listPublicProductDestinations } from '@/lib/public-api/products';
import { publicApiError } from '@/lib/public-api/response';

export const runtime = 'nodejs';


const DESTINATIONS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'products.read',
      rateLimit: DESTINATIONS_RATE_LIMIT,
    });
    const { id } = await params;
    const destinations = await listPublicProductDestinations(ctx.workspaceId, id);

    return Response.json({
      productId: id,
      destinations,
      count: destinations.length,
    }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
