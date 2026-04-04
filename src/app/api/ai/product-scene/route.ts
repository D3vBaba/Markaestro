import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { productSceneSchema } from '@/lib/schemas';
import { submitProductScene } from '@/lib/ai/product-scene-generator';
import { checkAndIncrementUsage } from '@/lib/usage';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ai.use');

    const quota = await checkAndIncrementUsage(ctx.uid, 'videoGenerations', ctx.workspaceId);
    if (!quota.allowed) throw new Error('VIDEO_QUOTA_EXCEEDED');

    const body = await req.json();
    const data = productSceneSchema.parse(body);

    // Fetch product details
    const productSnap = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`)
      .get();
    if (!productSnap.exists) {
      return apiError(new Error('Product not found'));
    }
    const product = productSnap.data()!;

    const result = await submitProductScene(
      {
        productId: data.productId,
        productName: product.name || 'Product',
        productDescription: product.description || '',
        productCategories: product.categories || [],
        sceneType: data.sceneType,
        promptMode: data.promptMode,
        customPrompt: data.customPrompt,
        avatarImageUrl: data.avatarImageUrl,
        productImageUrl: data.productImageUrl,
        sceneDescription: data.sceneDescription,
        provider: data.provider,
        durationSeconds: data.durationSeconds,
        voiceover: data.voiceover,
      },
      ctx.workspaceId,
    );

    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId,
      prompt: data.customPrompt || data.sceneDescription || data.sceneType,
      provider: 'product-scene' as const,
      videoProvider: data.provider,
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: data.durationSeconds,
      externalJobId: result.externalJobId,
      statusUrl: result.statusUrl,
      responseUrl: result.responseUrl,
      sceneType: data.sceneType,
      sceneImageUrl: result.sceneImageUrl,
      avatarImageUrl: data.avatarImageUrl || '',
      productImageUrl: data.productImageUrl || '',
      audioUrl: result.audioUrl || '',
      voice: data.voiceover?.voice || '',
      caption: data.caption,
      hashtags: data.hashtags,
      errorMessage: '',
      createdAt: new Date().toISOString(),
      completedAt: null,
      createdBy: ctx.uid,
    };

    await docRef.set(generationData);

    if (data.trendId) {
      await adminDb
        .doc(`workspaces/${ctx.workspaceId}/tiktokTrends/${data.trendId}`)
        .update({ status: 'used' });
    }

    return apiOk({ id: docRef.id, ...generationData });
  } catch (error) {
    return apiError(error);
  }
}
