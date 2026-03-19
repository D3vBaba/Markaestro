import { adminDb } from '@/lib/firebase-admin';
import { pollVideoGeneration, uploadVideoToStorage } from '@/lib/ai/video-generator';
import type { VideoProvider } from '@/lib/schemas';

export type VideoPollResult = {
  polled: number;
  completed: number;
  failed: number;
  errors: Array<{ workspaceId: string; generationId: string; error: string }>;
};

/**
 * Poll all in-progress video generations across all workspaces.
 * Called by the worker/tick endpoint on each cron run.
 */
export async function pollPendingVideoGenerations(): Promise<VideoPollResult> {
  const result: VideoPollResult = { polled: 0, completed: 0, failed: 0, errors: [] };

  const wsSnap = await adminDb.collection('workspaces').limit(200).get();

  for (const ws of wsSnap.docs) {
    const workspaceId = ws.id;

    // Find generations that are still in progress
    const genSnap = await adminDb
      .collection(`workspaces/${workspaceId}/videoGenerations`)
      .where('status', '==', 'generating')
      .limit(20)
      .get();

    for (const doc of genSnap.docs) {
      result.polled++;
      const gen = doc.data();

      try {
        const pollResult = await pollVideoGeneration(
          gen.provider as VideoProvider,
          gen.externalJobId,
        );

        if (pollResult.status === 'completed' && pollResult.videoUrl) {
          const storageUrl = await uploadVideoToStorage(pollResult.videoUrl, workspaceId);

          await doc.ref.update({
            status: 'completed',
            videoUrl: storageUrl,
            thumbnailUrl: pollResult.thumbnailUrl || '',
            completedAt: new Date().toISOString(),
          });

          // Create draft post
          const postCol = adminDb.collection(`workspaces/${workspaceId}/posts`);
          const postRef = postCol.doc();
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
            generatedBy: 'video-pipeline',
            campaignId: '',
            videoGenerationId: doc.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          await doc.ref.update({ postId: postRef.id });
          result.completed++;
        } else if (pollResult.status === 'failed') {
          await doc.ref.update({
            status: 'failed',
            errorMessage: pollResult.errorMessage || 'Video generation failed',
          });
          result.failed++;
        }
        // else still generating — no update needed
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push({ workspaceId, generationId: doc.id, error: msg });
        console.error(`[video-poll] Error polling ${doc.id}:`, msg);
      }
    }
  }

  return result;
}
