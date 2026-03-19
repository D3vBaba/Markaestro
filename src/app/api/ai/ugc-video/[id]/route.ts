import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { adminDb } from '@/lib/firebase-admin';
import { pollUGCVideo } from '@/lib/ai/ugc-video-generator';
import { uploadVideoToStorage } from '@/lib/ai/video-generator';

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

    if (gen.status === 'completed' || gen.status === 'failed') {
      return apiOk({ id, ...gen });
    }

    const result = await pollUGCVideo(gen.statusUrl, gen.responseUrl);

    if (result.status === 'completed' && result.videoUrl) {
      const storageUrl = await uploadVideoToStorage(result.videoUrl, ctx.workspaceId);

      const updates = {
        status: 'completed',
        videoUrl: storageUrl,
        completedAt: new Date().toISOString(),
      };
      await docRef.update(updates);

      // Create draft TikTok post
      const postRef = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`).doc();
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
        generatedBy: 'ugc-pipeline',
        campaignId: '',
        videoGenerationId: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await docRef.update({ postId: postRef.id });
      return apiOk({ id, ...gen, ...updates, postId: postRef.id });
    }

    if (result.status === 'failed') {
      const updates = { status: 'failed', errorMessage: result.errorMessage || 'UGC video generation failed' };
      await docRef.update(updates);
      return apiOk({ id, ...gen, ...updates });
    }

    return apiOk({ id, ...gen, status: 'generating' });
  } catch (error) {
    return apiError(error);
  }
}
