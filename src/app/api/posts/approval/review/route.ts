/**
 * POST /api/posts/approval/review — approve or reject a post that is pending_approval.
 * Requires the workspace post-review permission.
 */
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { z } from 'zod';

export const runtime = 'nodejs';


const reviewSchema = z.object({
  postId: z.string().trim().min(1),
  decision: z.enum(['approved', 'rejected']),
  feedback: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.review');

    const body = await req.json();
    const { postId, decision, feedback } = reviewSchema.parse(body);

    const postRef = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${postId}`);
    const snap = await postRef.get();
    if (!snap.exists) return apiError(new Error('NOT_FOUND'));

    const post = snap.data()!;
    if (post.status !== 'pending_approval') {
      return apiError(new Error('VALIDATION_INVALID_STATUS'));
    }

    const now = new Date().toISOString();

    if (decision === 'approved') {
      await postRef.update({
        status: 'approved',
        approvedAt: now,
        approvedBy: ctx.uid,
        rejectionFeedback: null,
        updatedAt: now,
      });
    } else {
      await postRef.update({
        status: 'rejected',
        rejectedAt: now,
        rejectedBy: ctx.uid,
        rejectionFeedback: feedback ?? '',
        updatedAt: now,
      });
    }

    return apiOk({ postId, status: decision === 'approved' ? 'approved' : 'rejected' });
  } catch (error) {
    return apiError(error);
  }
}
