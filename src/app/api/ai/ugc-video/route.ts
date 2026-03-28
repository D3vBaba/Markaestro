import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { submitUGCVideo, KOKORO_VOICES } from '@/lib/ai/ugc-video-generator';
import { checkAndIncrementUsage } from '@/lib/usage';
import { z } from 'zod';

const allVoices = [...KOKORO_VOICES.female, ...KOKORO_VOICES.male] as const;

const ugcVideoSchema = z.object({
  script: z.string().trim().min(1).max(8000),
  imageUrl: z.string().trim().url(),
  voice: z.enum(allVoices).default('af_heart'),
  speed: z.number().min(0.5).max(2.0).default(1.0),
  productId: z.string().trim().optional(),
  trendId: z.string().trim().optional(),
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);

    const quota = await checkAndIncrementUsage(ctx.uid, 'videoGenerations');
    if (!quota.allowed) throw new Error('VIDEO_QUOTA_EXCEEDED');

    const body = await req.json();
    const data = ugcVideoSchema.parse(body);

    const result = await submitUGCVideo({
      imageUrl: data.imageUrl,
      script: data.script,
      voice: data.voice,
      speed: data.speed,
    });

    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId || '',
      prompt: data.script,
      provider: 'kling-avatar',
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: 0,
      externalJobId: result.externalJobId,
      statusUrl: result.statusUrl,
      responseUrl: result.responseUrl,
      audioUrl: result.audioUrl,
      caption: data.caption,
      hashtags: data.hashtags,
      errorMessage: '',
      avatarImageUrl: data.imageUrl,
      voice: data.voice,
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
