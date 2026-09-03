import { z } from 'zod';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { previewEvergreenQueue } from '@/lib/evergreen/storage';
import { EVERGREEN_PUBLIC_RATE_LIMIT } from '@/lib/public-api/evergreen';

const previewSchema = z.object({ sourcePostId: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.read', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const { sourcePostId } = previewSchema.parse(await req.json());
    const preview = await previewEvergreenQueue(ctx.workspaceId, sourcePostId);
    if (preview.productId !== ctx.productId) throw new Error('VALIDATION_PRODUCT_SCOPE_MISMATCH');
    return Response.json({ preview }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
