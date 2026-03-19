import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { submitLipsync } from '@/lib/ai/creatify-client';
import { z } from 'zod';

const ugcVideoSchema = z.object({
  script: z.string().trim().min(1).max(8000),
  avatarId: z.string().trim().min(1),
  productId: z.string().trim().optional(),
  trendId: z.string().trim().optional(),
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
  captionStyle: z.string().trim().default('neo'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const data = ugcVideoSchema.parse(body);

    // Submit to Creatify
    const result = await submitLipsync({
      text: data.script,
      creator: data.avatarId,
      aspect_ratio: '9x16',
      no_caption: false,
      no_music: true,
      caption_style: data.captionStyle,
    });

    // Save generation record
    const genCol = adminDb.collection(`workspaces/${ctx.workspaceId}/videoGenerations`);
    const docRef = genCol.doc();

    const generationData = {
      trendId: data.trendId || '',
      productId: data.productId || '',
      prompt: data.script,
      provider: 'creatify',
      status: 'generating',
      videoUrl: '',
      thumbnailUrl: '',
      durationSeconds: 0,
      externalJobId: result.id,
      // Store Creatify poll URL pattern
      statusUrl: `https://api.creatify.ai/api/lipsyncs/${result.id}/`,
      responseUrl: `https://api.creatify.ai/api/lipsyncs/${result.id}/`,
      caption: data.caption,
      hashtags: data.hashtags,
      errorMessage: '',
      avatarId: data.avatarId,
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
