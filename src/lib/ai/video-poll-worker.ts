import { adminDb } from '@/lib/firebase-admin';
import { pollVideoGeneration, uploadVideoToStorage } from '@/lib/ai/video-generator';
import { pollUGCVideo } from '@/lib/ai/ugc-video-generator';

export type VideoPollResult = {
  polled: number;
  completed: number;
  failed: number;
  errors: Array<{ workspaceId: string; generationId: string; error: string }>;
};

/**
 * Poll a single generation job. Handles fal.ai B-roll (Kling/Veo/Sora)
 * and fal.ai UGC (MultiTalk) providers.
 */
async function pollSingleGeneration(
  gen: FirebaseFirestore.DocumentData,
  docRef: FirebaseFirestore.DocumentReference,
  workspaceId: string,
  docId: string,
): Promise<'completed' | 'failed' | 'generating'> {
  let videoUrl: string | undefined;
  let errorMessage = '';
  let status: 'completed' | 'failed' | 'generating' = 'generating';

  if (gen.provider === 'kling-avatar' || gen.provider === 'veed-fabric' || gen.provider === 'multitalk') {
    const result = await pollUGCVideo(gen.statusUrl, gen.responseUrl);
    if (result.status === 'completed' && result.videoUrl) {
      videoUrl = result.videoUrl;
      status = 'completed';
    } else if (result.status === 'failed') {
      errorMessage = result.errorMessage || 'UGC video generation failed';
      status = 'failed';
    }
  } else {
    // fal.ai B-roll pipeline (kling, veo, sora)
    const result = await pollVideoGeneration(gen.statusUrl, gen.responseUrl);
    if (result.status === 'completed' && result.videoUrl) {
      videoUrl = result.videoUrl;
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
      completedAt: new Date().toISOString(),
    });

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
      ...(gen.productId ? { productId: gen.productId } : {}),
      generatedBy: gen.provider === 'multitalk' ? 'ugc-pipeline' : 'video-pipeline',
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
        const s = await pollSingleGeneration(doc.data(), doc.ref, workspaceId, doc.id);
        if (s === 'completed') result.completed++;
        else if (s === 'failed') result.failed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push({ workspaceId, generationId: doc.id, error: msg });
        console.error(`[video-poll] Error polling ${doc.id}:`, msg);
      }
    }
  }

  return result;
}
