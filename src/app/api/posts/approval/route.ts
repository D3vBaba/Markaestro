/**
 * POST /api/posts/approval — submit a draft post for approval review
 * PATCH /api/posts/approval — approve or reject a post under review
 *
 * Post status lifecycle with approval workflows enabled:
 *   draft → pending_approval → approved → scheduled/published
 *                           ↘ rejected → draft (with feedback)
 */
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiOk, apiError } from '@/lib/api-response';
import { z } from 'zod';

const submitSchema = z.object({
  postId: z.string().trim().min(1),
});

const reviewSchema = z.object({
  postId: z.string().trim().min(1),
  decision: z.enum(['approved', 'rejected']),
  feedback: z.string().trim().max(1000).optional(),
});

/** POST — submit a draft for review */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { postId } = submitSchema.parse(body);

    const postRef = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${postId}`);
    const snap = await postRef.get();
    if (!snap.exists) return apiError(new Error('NOT_FOUND'));

    const post = snap.data()!;
    if (post.createdBy !== ctx.uid && post.status !== 'draft' && post.status !== 'rejected') {
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

/** PATCH — approve or reject a post that is pending_approval */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

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
