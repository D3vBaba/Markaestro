import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { writeUGCScript, type ScriptInput } from '@/lib/ai/ugc-script-writer';
import { z } from 'zod';

const scriptSchema = z.object({
  productId: z.string().trim().min(1),
  trendId: z.string().trim().optional(),
  scriptStyle: z.enum(['testimonial', 'problem-solution', 'review', 'routine', 'comparison']).default('problem-solution'),
  durationSeconds: z.number().int().min(15).max(60).default(30),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');
    const body = await req.json();
    const data = scriptSchema.parse(body);

    // Fetch product
    const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`).get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const product = productSnap.data()!;

    // Fetch trend if provided
    let trendName: string | undefined;
    let trendFormat: string | undefined;
    let hooks: string[] | undefined;
    if (data.trendId) {
      const trendSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/tiktokTrends/${data.trendId}`).get();
      if (trendSnap.exists) {
        const trend = trendSnap.data()!;
        trendName = trend.name;
        trendFormat = trend.format;
        hooks = trend.hooks;
      }
    }

    const input: ScriptInput = {
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      brandVoice: product.brandVoice,
      trendName,
      trendFormat,
      hooks,
      scriptStyle: data.scriptStyle,
      durationSeconds: data.durationSeconds,
    };

    const script = await writeUGCScript(input);

    return apiOk(script);
  } catch (error) {
    return apiError(error);
  }
}
