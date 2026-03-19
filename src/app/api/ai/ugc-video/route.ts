import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { submitUGCVideo } from '@/lib/ai/ugc-video-generator';
import { z } from 'zod';

const ugcVideoSchema = z.object({
  script: z.string().trim().min(1).max(8000),
  imageUrl: z.string().trim().url(),
  voiceDescription: z.string().trim().max(200).optional(),
  productId: z.string().trim().optional(),
  trendId: z.string().trim().optional(),
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = ugcVideoSchema.parse(body);

    const result = await submitUGCVideo({
      imageUrl: data.imageUrl,
      script: data.script,
      voiceDescription: data.voiceDescription,
      resolution: '720p',
    });

    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId || '',
      prompt: data.script,
      provider: 'veed-fabric',
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: 0,
      externalJobId: result.externalJobId,
      statusUrl: result.statusUrl,
      responseUrl: result.responseUrl,
      caption: data.caption,
      hashtags: data.hashtags,
      errorMessage: '',
      avatarImageUrl: data.imageUrl,
      voiceDescription: data.voiceDescription || '',
      scriptStyle: 'ugc',
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
