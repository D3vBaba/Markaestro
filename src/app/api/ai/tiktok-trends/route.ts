import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { researchTikTokTrends, type TrendResearchInput } from '@/lib/ai/tiktok-trend-researcher';
import { z } from 'zod';

const researchSchema = z.object({
  productId: z.string().trim().min(1, 'productId is required'),
  focusArea: z.string().trim().max(200).optional(),
});

/**
 * POST /api/ai/tiktok-trends — Research viral TikTok trends for a product.
 * Saves discovered trends to Firestore and returns them.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { productId, focusArea } = researchSchema.parse(body);

    // Fetch product details
    const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}`);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const product = productSnap.data()!;

    const input: TrendResearchInput = {
      productName: product.name,
      productDescription: product.description || '',
      productCategories: product.categories || [],
      brandVoice: product.brandVoice,
      focusArea,
    };

    const result = await researchTikTokTrends(input);

    // Save each trend to Firestore
    const trendsCol = adminDb.collection(`workspaces/${ctx.workspaceId}/tiktokTrends`);
    const savedTrends: Array<{ id: string } & Record<string, unknown>> = [];

    for (const trend of result.trends) {
      const docRef = trendsCol.doc();
      const trendData = {
        ...trend,
        productId,
        status: 'suggested',
        createdAt: new Date().toISOString(),
        createdBy: ctx.uid,
      };
      await docRef.set(trendData);
      savedTrends.push({ id: docRef.id, ...trendData });
    }

    return apiOk({
      trends: savedTrends,
      researchedAt: result.researchedAt,
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * GET /api/ai/tiktok-trends — List saved TikTok trends for the workspace.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const productId = url.searchParams.get('productId');

    let query = adminDb
      .collection(`workspaces/${ctx.workspaceId}/tiktokTrends`)
      .orderBy('createdAt', 'desc')
      .limit(50);

    if (status) {
      query = query.where('status', '==', status);
    }
    if (productId) {
      query = query.where('productId', '==', productId);
    }

    const snap = await query.get();
    const trends = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return apiOk({ trends });
  } catch (error) {
    return apiError(error);
  }
}
