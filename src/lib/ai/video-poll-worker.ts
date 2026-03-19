import { adminDb } from '@/lib/firebase-admin';
import { pollVideoGeneration, uploadVideoToStorage } from '@/lib/ai/video-generator';
import { pollLipsync } from '@/lib/ai/creatify-client';

export type VideoPollResult = {
  polled: number;
  completed: number;
  failed: number;
  errors: Array<{ workspaceId: string; generationId: string; error: string }>;
};

/**
 * Poll a single generation job. Handles both fal.ai (Kling/Veo/Sora) and Creatify providers.
 */
async function pollSingleGeneration(
  gen: FirebaseFirestore.DocumentData,
  docRef: FirebaseFirestore.DocumentReference,
  workspaceId: string,
  docId: string,
): Promise<'completed' | 'failed' | 'generating'> {
  let videoUrl: string | undefined;
  let thumbnailUrl = '';
  let durationSeconds = 0;
  let errorMessage = '';
  let status: 'completed' | 'failed' | 'generating' = 'generating';

  if (gen.provider === 'creatify') {
    // Creatify UGC pipeline
    const result = await pollLipsync(gen.externalJobId);
    if (result.status === 'done' && result.output) {
      videoUrl = result.output;
      thumbnailUrl = result.video_thumbnail || '';
      durationSeconds = result.duration || 0;
      status = 'completed';
    } else if (result.status === 'failed') {
      errorMessage = result.failed_reason || 'UGC video generation failed';
      status = 'failed';
    }
  } else {
    // fal.ai pipeline (kling, veo, sora)
    const result = await pollVideoGeneration(gen.statusUrl, gen.responseUrl);
    if (result.status === 'completed' && result.videoUrl) {
      videoUrl = result.videoUrl;
      thumbnailUrl = result.thumbnailUrl || '';
      status = 'completed';
    } else if (result.status === 'failed') {
      errorMessage = result.errorMessage || 'Video generation failed';
      status = 'failed';
    }
  }

  if (status === 'completed' && videoUrl) {
    const storageUrl = await uploadVideoToStorage(videoUrl, workspaceId);

    await docRef.update({
      status: 'completed',
      videoUrl: storageUrl,
      thumbnailUrl,
      durationSeconds,
      completedAt: new Date().toISOString(),
    });

    // Create draft post
    const postRef = adminDb.collection(`workspaces/${workspaceId}/posts`).doc();
    const caption = gen.caption || '';
    const hashtags: string[] = gen.hashtags || [];
    const fullCaption = hashtags.length > 0
      ? `${caption}\n\n${hashtags.join(' ')}`
      : caption;

    await postRef.set({
      content: fullCaption,
      channel: 'tiktok',
      status: 'draft',
      scheduledAt: null,
      mediaUrls: [storageUrl],
      productId: gen.productId || '',
      generatedBy: gen.provider === 'creatify' ? 'ugc-pipeline' : 'video-pipeline',
      campaignId: '',
      videoGenerationId: docId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await docRef.update({ postId: postRef.id });
  } else if (status === 'failed') {
    await docRef.update({ status: 'failed', errorMessage });
  }

  return status;
}

/**
 * Poll all in-progress video generations across all workspaces.
 * Handles both fal.ai and Creatify providers.
 */
export async function pollPendingVideoGenerations(): Promise<VideoPollResult> {
  const result: VideoPollResult = { polled: 0, completed: 0, failed: 0, errors: [] };

  const wsSnap = await adminDb.collection('workspaces').limit(200).get();

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;

    const genSnap = await adminDb
      .collection(`workspaces/${workspaceId}/videoGenerations`)
      .where('status', '==', 'generating')
      .limit(20)
      .get();

    for (const doc of genSnap.docs) {
      result.polled++;
      try {
        const status = await pollSingleGeneration(doc.data(), doc.ref, workspaceId, doc.id);
        if (status === 'completed') result.completed++;
        else if (status === 'failed') result.failed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push({ workspaceId, generationId: doc.id, error: msg });
        console.error(`[video-poll] Error polling ${doc.id}:`, msg);
      }
    }
  }

  return result;
}
