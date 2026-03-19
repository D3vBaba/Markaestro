import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { pollVideoGeneration, uploadVideoToStorage } from '@/lib/ai/video-generator';
import type { VideoProvider } from '@/lib/schemas';

/**
 * GET /api/ai/video-status/[id] — Poll the status of a video generation job.
 * When complete, downloads the video to Firebase Storage and creates a draft TikTok post.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const docRef = adminDb.doc(`workspaces/${ctx.workspaceId}/videoGenerations/${id}`);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const gen = snap.data()!;

    // Already completed or failed — return cached result
    if (gen.status === 'completed' || gen.status === 'failed') {
      return apiOk({ id, ...gen });
    }

    // Poll the provider
    const result = await pollVideoGeneration(
      gen.provider as VideoProvider,
      gen.externalJobId,
    );

    if (result.status === 'completed' && result.videoUrl) {
      // Download video to Firebase Storage for permanent URL
      const storageUrl = await uploadVideoToStorage(result.videoUrl, ctx.workspaceId);

      // Update generation record
      const updates = {
        status: 'completed',
        videoUrl: storageUrl,
        thumbnailUrl: result.thumbnailUrl || '',
        completedAt: new Date().toISOString(),
      };
      await docRef.update(updates);

      // Create a draft TikTok post
      const postCol = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`);
      const postRef = postCol.doc();
      const caption = gen.caption || '';
      const hashtags: string[] = gen.hashtags || [];
      const fullCaption = hashtags.length > 0
        ? `${caption}\n\n${hashtags.join(' ')}`
        : caption;

      const postData = {
        content: fullCaption,
        channel: 'tiktok',
        status: 'draft',
        scheduledAt: null,
        mediaUrls: [storageUrl],
        productId: gen.productId || '',
        generatedBy: 'video-pipeline',
        campaignId: '',
        videoGenerationId: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await postRef.set(postData);

      // Link the post back to the generation
      await docRef.update({ postId: postRef.id });

      return apiOk({
        id,
        ...gen,
        ...updates,
        postId: postRef.id,
      });
    }

    if (result.status === 'failed') {
      const updates = {
        status: 'failed',
        errorMessage: result.errorMessage || 'Video generation failed',
      };
      await docRef.update(updates);
      return apiOk({ id, ...gen, ...updates });
    }

    // Still generating
    return apiOk({ id, ...gen, status: 'generating' });
  } catch (error) {
    return apiError(error);
  }
}
