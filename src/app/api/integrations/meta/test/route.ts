import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';
import { getConnection } from '@/lib/platform/connections';
import { getAdapter } from '@/lib/platform/registry';

const testSchema = z.object({
  provider: z.enum(['facebook', 'instagram']).default('facebook'),
  productId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { productId } = testSchema.parse(body);

    const conn = await getConnection(ctx.workspaceId, 'meta', productId);
    if (!conn) {
      throw new Error('VALIDATION_MISSING_META_TOKEN');
    }

    const adapter = getAdapter('meta-publishing');
    if (!adapter) {
      throw new Error('Meta adapter not found');
    }

    const result = await adapter.testConnection(conn);
    return apiOk({ ok: result.ok, data: { name: result.label }, error: result.error });
  } catch (error) {
    return apiError(error);
  }
}
