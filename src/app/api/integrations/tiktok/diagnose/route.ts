import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { fetchTikTokPublishStatus } from '@/lib/platform/adapters/tiktok-publishing';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';

export const runtime = 'nodejs';

type TikTokPostSnapshot = {
  workspaceId: string;
  postId: string;
  status?: string;
  nextAction?: string;
  channel?: string;
  externalId?: string;
  externalUrl?: string;
  productId?: string;
  publishedAt?: string;
  exportedForReviewAt?: string;
  updatedAt?: string;
  createdAt?: string;
  errorMessage?: string;
  publishResults?: unknown;
  createdByType?: string;
  createdById?: string;
};

function interpret(
  tkStatus: string | undefined,
  failReason: string | undefined,
  apiError: string | undefined,
): string {
  if (apiError) return `TikTok API error: ${apiError}`;
  switch (tkStatus) {
    case 'PROCESSING_UPLOAD':
    case 'PROCESSING_DOWNLOAD':
      return 'TikTok is still processing the upload. Poll again shortly.';
    case 'SEND_TO_USER_INBOX':
      return 'Delivered to the TikTok app inbox. Open TikTok → Inbox tab → look for the upload notification. Drafts expire after ~7 days if not finalized.';
    case 'PUBLISH_COMPLETE':
      return 'TikTok reports the post is live.';
    case 'FAILED':
      return `TikTok rejected the post: ${failReason || 'no reason given'}`;
    default:
      return tkStatus ? `Unknown TikTok status: ${tkStatus}` : 'No status returned by TikTok.';
  }
}

async function loadPost(workspaceId: string, postId?: string): Promise<TikTokPostSnapshot | null> {
  if (postId) {
    const snap = await adminDb.doc(`workspaces/${workspaceId}/posts/${postId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data.channel !== 'tiktok') return null;
    return { workspaceId, postId: snap.id, ...(data as Record<string, unknown>) };
  }

  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('channel', '==', 'tiktok')
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { workspaceId, postId: doc.id, ...(doc.data() as Record<string, unknown>) };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');

    const url = new URL(req.url);
    const postId = url.searchParams.get('postId') || undefined;

    const post = await loadPost(ctx.workspaceId, postId);
    if (!post) {
      return apiOk({ ok: false, error: postId ? 'Post not found' : 'No TikTok posts in this workspace' });
    }

    const response: Record<string, unknown> = { ok: true, post };

    if (!post.externalId) {
      response.tiktok = null;
      response.interpretation =
        'No externalId (publish_id) stored. The init call likely failed before TikTok returned one — check errorMessage and publishResults.';
      return apiOk(response);
    }

    const connection = await getConnectionForChannel(ctx.workspaceId, 'tiktok', post.productId);
    if (!connection) {
      response.tiktok = null;
      response.interpretation = 'No TikTok connection found — cannot query live status.';
      return apiOk(response);
    }

    const status = await fetchTikTokPublishStatus(getAccessToken(connection), post.externalId);
    response.connection = {
      provider: connection.provider,
      productId: connection.productId,
      status: connection.status,
      openId: connection.metadata?.openId,
      username: connection.metadata?.username,
      scope: connection.metadata?.scope,
      tokenExpiresAt: connection.tokenExpiresAt,
    };
    response.tiktok = status;
    response.interpretation = interpret(status.status, status.failReason, status.error);

    return apiOk(response);
  } catch (error) {
    return apiError(error);
  }
}
