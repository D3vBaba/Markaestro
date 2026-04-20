/**
 * POST /api/posts/approval — submit a draft post for approval review.
 *
 * Post status lifecycle with approval workflows enabled:
 *   draft → pending_approval → approved → scheduled/published
 *                           ↘ rejected → draft (with feedback)
 *
 * Review (approve/reject) is handled by POST /api/posts/approval/review.
 */
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { z } from 'zod';

export const runtime = 'nodejs';


const submitSchema = z.object({
  postId: z.string().trim().min(1),
});

/** POST — submit a draft for review (only the post author can submit) */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const body = await req.json();
    const { postId } = submitSchema.parse(body);

    const postRef = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${postId}`);
    const snap = await postRef.get();
    if (!snap.exists) return apiError(new Error('NOT_FOUND'));

    const post = snap.data()!;
    if (post.createdBy !== ctx.uid) {
      return apiError(new Error('FORBIDDEN'));
    }
    if (post.status !== 'draft' && post.status !== 'rejected') {
      return apiError(new Error('VALIDATION_INVALID_STATUS'));
    }

    await postRef.update({
      status: 'pending_approval',
      submittedForApprovalAt: new Date().toISOString(),
      submittedBy: ctx.uid,
      rejectionFeedback: null,
      updatedAt: new Date().toISOString(),
    });

    return apiOk({ postId, status: 'pending_approval' });
  } catch (error) {
    return apiError(error);
  }
}
