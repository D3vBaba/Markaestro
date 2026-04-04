import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { facelessNarratedSchema } from '@/lib/schemas';
import { submitFacelessNarrated } from '@/lib/ai/faceless-narrated-generator';
import { checkAndIncrementUsage } from '@/lib/usage';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const quota = await checkAndIncrementUsage(ctx.uid, 'videoGenerations');
    if (!quota.allowed) throw new Error('VIDEO_QUOTA_EXCEEDED');

    const body = await req.json();
    const data = facelessNarratedSchema.parse(body);

    // Fetch product details
    const productSnap = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${data.productId}`)
      .get();
    if (!productSnap.exists) {
      return apiError(new Error('Product not found'));
    }
    const product = productSnap.data()!;

    // Fetch trend context if provided
    let trendContext: { name: string; format: string; hooks: string[] } | undefined;
    if (data.trendId) {
      const trendSnap = await adminDb
        .doc(`workspaces/${ctx.workspaceId}/tiktokTrends/${data.trendId}`)
        .get();
      if (trendSnap.exists) {
        const t = trendSnap.data()!;
        trendContext = { name: t.name, format: t.format, hooks: t.hooks || [] };
      }
    }

    const result = await submitFacelessNarrated({
      productName: product.name || 'Product',
      productDescription: product.description || '',
      productCategories: product.categories || [],
      brandVoice: product.brandVoice,
      promptMode: data.promptMode,
      customPrompt: data.customPrompt,
      sceneCount: data.sceneCount,
      durationSeconds: data.durationSeconds,
      voice: data.voice,
      speed: data.speed,
      script: data.script,
      scriptStyle: data.scriptStyle,
      trendContext,
    });

    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId,
      prompt: data.customPrompt || result.narrationScript,
      provider: 'faceless-narrated' as const,
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: data.durationSeconds,
      externalJobId: result.externalJobId,
      statusUrl: result.statusUrl,
      responseUrl: result.responseUrl,
      audioUrl: result.audioUrl,
      voice: data.voice,
      narrationScript: result.narrationScript,
      scenes: result.scenes,
      sceneCount: data.sceneCount,
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
