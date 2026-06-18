import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { updatePostSchema } from '@/lib/schemas';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    return apiOk({ id, ...snap.data() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const body = await req.json();
    const data = updatePostSchema.parse(body);

    // Moving a post into "scheduled" queues an outbound publish, so it requires
    // a verified email. Editing drafts/content stays open to unverified users.
    if (data.status === 'scheduled' && !ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to publish.' },
        403,
      );
    }

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const existing = snap.data() as Record<string, unknown>;
    const nextPost = {
      ...existing,
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    };

    if (nextPost.status === 'scheduled') {
      const issues = await getSocialPostPreflightIssues(
        ctx.workspaceId,
        typeof nextPost.productId === 'string' && nextPost.productId ? nextPost.productId : undefined,
        {
          content: typeof nextPost.content === 'string' ? nextPost.content : '',
          channel: typeof nextPost.channel === 'string' ? nextPost.channel : undefined,
          targetChannels: Array.isArray(nextPost.targetChannels) ? nextPost.targetChannels : undefined,
          mediaUrls: Array.isArray(nextPost.mediaUrls) ? nextPost.mediaUrls.filter((url): url is string => typeof url === 'string') : undefined,
        },
        { requireReadyChannels: true },
      );
      if (issues.length > 0) {
        return apiOk({ error: 'VALIDATION_ERROR', issues }, 400);
      }
    }

    // Strip undefined keys so we only overwrite fields explicitly sent
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );
    const clearsPublishResults = ['content', 'channel', 'targetChannels', 'mediaUrls', 'productId', 'destinationProvider']
      .some((key) => key in filtered);
    const patch = {
      ...filtered,
      ...(clearsPublishResults
        ? {
            publishResults: [],
            publishedChannels: [],
            retryFailedChannelsOnly: null,
            externalId: '',
            externalUrl: '',
            errorMessage: '',
          }
        : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };
    await ref.update(patch);
    return apiOk({ id, ...snap.data(), ...patch });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    await ref.delete();

    return apiOk({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
