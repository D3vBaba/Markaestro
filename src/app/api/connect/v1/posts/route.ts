// Connect API: /api/connect/v1/posts
//   POST → create a Markaestro post for each selected destination (fan-out).
//   GET  → list workspace posts in Connect's shape.
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicPost } from '@/lib/public-api/posts';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { parseAccountId, mapPostStatus } from '@/lib/public-api/connect-compat';

export const runtime = 'nodejs';

const POSTS_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.write',
      rateLimit: POSTS_RATE_LIMIT,
    });

    const body = (await req.json().catch(() => ({}))) as {
      caption?: string;
      media?: string[]; // Markaestro media_asset ids (from the upload layer)
      social_accounts?: string[]; // encoded destination tokens
      scheduled_at?: string | null;
      is_draft?: boolean;
    };

    const caption = body.caption || '';
    const mediaAssetIds = Array.isArray(body.media) ? body.media.map(String) : [];
    const accounts = Array.isArray(body.social_accounts) ? body.social_accounts.map(String) : [];
    if (accounts.length === 0) throw new Error('VALIDATION_NO_DESTINATION');
    // Connect create is draft-first. Scheduling clients may send scheduling
    // fields, but Markaestro stores drafts so users can publish intentionally
    // from the matching product workflow.
    const scheduledAt = null;

    const created: Array<{ id: string; channel: string; status: string }> = [];
    const errors: Array<{ account: string; error: string }> = [];

    for (const account of accounts) {
      const { productId, destinationId, channel } = parseAccountId(account);
      try {
        const post = await createPublicPost(ctx, {
          channel,
          caption,
          mediaAssetIds,
          scheduledAt,
          productId,
          destinationId,
        });
        created.push({ id: post.id, channel: post.channel, status: post.status });
      } catch (e) {
        errors.push({ account, error: e instanceof Error ? e.message : 'UNKNOWN_ERROR' });
      }
    }

    if (created.length === 0) {
      // Every destination failed — surface the first error with a 400.
      throw new Error(errors[0]?.error || 'VALIDATION_POST_CREATE_FAILED');
    }

    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'post_create');
    // Connect returns a single post object; the client only needs an id.
    return Response.json(
      { id: created[0].id, created, errors },
      { status: 201, headers: ctx.rateLimitHeaders },
    );
  } catch (error) {
    return publicApiError(error);
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 100);

    const snap = await adminDb
      .collection(workspaceCollection(ctx.workspaceId, 'posts'))
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    // A product-bound key only sees its own product's posts (filtered in memory
    // to avoid requiring a productId+createdAt composite index).
    const docs = ctx.productId
      ? snap.docs.filter((doc) => (doc.data() as { productId?: string }).productId === ctx.productId)
      : snap.docs;

    const data = docs.map((doc) => {
      const p = doc.data() as Record<string, unknown>;
      const mediaUrls = Array.isArray(p.mediaUrls) ? (p.mediaUrls as unknown[]).map(String) : [];
      const status = mapPostStatus(p.status);
      return {
        id: doc.id,
        caption: String(p.content || ''),
        status,
        scheduled_at: (p.scheduledAt as string) || null,
        // Shape media so the client's media.object.url resolver finds the urls.
        media: mediaUrls.map((u) => ({ object: { url: u } })),
        media_urls: mediaUrls,
        social_accounts: [],
        is_draft: status === 'draft',
      };
    });

    return Response.json({ data }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
