import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getMetaConnectionMerged, getConnectionRef } from '@/lib/platform/connections';
import { z } from 'zod';

const schema = z.object({
  adAccountId: z.string().min(1, 'Ad account ID is required'),
  productId: z.string().min(1, 'Product ID is required'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const body = await req.json();
    const { adAccountId, productId } = schema.parse(body);

    const conn = await getMetaConnectionMerged(ctx.workspaceId, productId);
    if (!conn) {
      throw new Error('NOT_FOUND');
    }

    const ref = getConnectionRef(ctx.workspaceId, 'meta', productId);
    await ref.update({
      'metadata.adAccountId': adAccountId,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    });

    return apiOk({ ok: true, adAccountId });
  } catch (error) {
    return apiError(error);
  }
}
