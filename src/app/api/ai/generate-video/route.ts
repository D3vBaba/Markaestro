import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { generateVideoSchema } from '@/lib/schemas';
import { submitVideoGeneration, type VideoGenRequest } from '@/lib/ai/video-generator';

/**
 * POST /api/ai/generate-video — Start a video generation job.
 * Returns immediately with a generation ID for polling via /api/ai/video-status/[id].
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = generateVideoSchema.parse(body);

    // Fetch product details if provided
    let productName: string | undefined;
    let productDescription: string | undefined;
    let productCategories: string[] | undefined;
    let brandVoice: Record<string, unknown> | undefined;

    if (data.productId) {
      const productRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`);
      const productSnap = await productRef.get();
      if (productSnap.exists) {
        const product = productSnap.data()!;
        productName = product.name;
        productDescription = product.description;
        productCategories = product.categories;
        brandVoice = product.brandVoice;
      }
    }

    // Fetch trend context if provided
    let trendContext: VideoGenRequest['trendContext'];
    if (data.trendId) {
      const trendRef = adminDb.doc(`workspaces/${ctx.workspaceId}/tiktokTrends/${data.trendId}`);
      const trendSnap = await trendRef.get();
      if (trendSnap.exists) {
        const trend = trendSnap.data()!;
        trendContext = {
          name: trend.name,
          format: trend.format,
          hooks: trend.hooks || [],
        };
      }
    }

    // Submit to video generation provider
    const result = await submitVideoGeneration({
      prompt: data.prompt,
      productName,
      productDescription,
      productCategories,
      brandVoice: brandVoice as VideoGenRequest['brandVoice'],
      provider: data.provider,
      durationSeconds: data.durationSeconds,
      trendContext,
    });

    // Save generation record to Firestore
    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId || '',
      prompt: data.prompt,
      provider: result.provider,
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: data.durationSeconds,
      externalJobId: result.externalJobId,
      caption: data.caption,
      hashtags: data.hashtags,
      errorMessage: '',
      createdAt: new Date().toISOString(),
      completedAt: null,
      createdBy: ctx.uid,
    };

    await docRef.set(generationData);

    // Mark trend as used if applicable
    if (data.trendId) {
      await adminDb
        .doc(`workspaces/${ctx.workspaceId}/tiktokTrends/${data.trendId}`)
        .update({ status: 'used' });
    }

    return apiOk({
      id: docRef.id,
      ...generationData,
    });
  } catch (error) {
    return apiError(error);
  }
}
