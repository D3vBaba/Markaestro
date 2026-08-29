// Connect API: /api/connect/v1/posts
//   POST → create a Markaestro post for each selected destination (fan-out).
//   GET  → list workspace posts in Connect's shape.
import { adminDb } from '@/lib/firebase-admin';
import { workspaceCollection } from '@/lib/firestore-paths';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { createPublicPost } from '@/lib/public-api/posts';
import { executeListQueryPage, type FieldFilter } from '@/lib/firestore-list-query';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import {
  getConnectDeliveryMode,
  mapPostStatus,
  parseAccountId,
  resolveConnectSchedule,
  validateConnectPostFanout,
} from '@/lib/public-api/connect-compat';
import {
  createRequestHash,
  getIdempotencyKey,
  loadIdempotentResponse,
  persistIdempotentResponse,
} from '@/lib/public-api/idempotency';

export const runtime = 'nodejs';

const POSTS_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const DESTINATION_CREATE_CONCURRENCY = 4;

export async function POST(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.write',
      rateLimit: POSTS_RATE_LIMIT,
    });

    const raw = await req.text();
    const body = (raw ? JSON.parse(raw) : {}) as {
      caption?: string;
      media?: string[]; // Markaestro media_asset ids (from the upload layer)
      social_accounts?: string[]; // encoded destination tokens
      scheduled_at?: string | null;
      is_draft?: boolean;
    };

    // This is the route third-party scheduling clients actually call, and the
    // one that fans out across up to four destinations concurrently, so a
    // retried request used to create duplicates on every destination.
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(raw) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const caption = body.caption || '';
    const mediaAssetIds = Array.isArray(body.media) ? body.media.map(String) : [];
    const accounts = Array.isArray(body.social_accounts) ? body.social_accounts.map(String) : [];
    if (accounts.length === 0) throw new Error('VALIDATION_NO_DESTINATION');
    validateConnectPostFanout({ caption, mediaAssetIds, accounts });
    // Stay draft-first unless the scheduling client explicitly requests a
    // non-draft post with a timestamp. TikTok schedules an inbox handoff, never
    // an unattended public Direct Post.
    const scheduledAt = resolveConnectSchedule(body.scheduled_at, body.is_draft);

    const outcomes: Array<
      | { ok: true; value: { id: string; channel: string; status: string } }
      | { ok: false; value: { account: string; error: string }; cause: unknown }
    > = new Array(accounts.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < accounts.length) {
        const index = cursor++;
        const account = accounts[index];
        const { productId, destinationId, channel } = parseAccountId(account);
        try {
          const post = await createPublicPost(ctx, {
            channel,
            caption,
            mediaAssetIds,
            // Scheduling is handled inside createPublicPost now, so this
            // surface and the public API run one code path: same preflight,
            // same originalScheduledAt, same due marker.
            scheduledAt,
            productId,
            destinationId,
            // Every Connect create opts into API publishing, scheduled or not.
            // Draft-then-publish is the standard flow for off-the-shelf
            // scheduling clients, and it used to inherit the public API's
            // manual-reminder default for Meta channels, so the later publish
            // call parked the post in the manual queue instead of sending it.
            deliveryMode: getConnectDeliveryMode(channel),
          });
          outcomes[index] = {
            ok: true,
            value: { id: post.id, channel: post.channel, status: post.status },
          };
        } catch (e) {
          // `cause` keeps the original error so an all-destinations failure can
          // rethrow it intact: re-wrapping in a bare Error would drop the
          // message and details a structured validation error carries.
          outcomes[index] = {
            ok: false,
            value: { account, error: e instanceof Error ? e.message : 'UNKNOWN_ERROR' },
            cause: e,
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(DESTINATION_CREATE_CONCURRENCY, accounts.length) }, () => worker()),
    );
    const created = outcomes.filter((outcome): outcome is Extract<(typeof outcomes)[number], { ok: true }> => outcome.ok).map((outcome) => outcome.value);
    const failures = outcomes.filter((outcome): outcome is Extract<(typeof outcomes)[number], { ok: false }> => !outcome.ok);
    const errors = failures.map((outcome) => outcome.value);

    if (created.length === 0) {
      // Every destination failed. Surface the first error as-is so a channel
      // limit reaches the caller with its message and details attached.
      if (failures[0]) throw failures[0].cause;
      throw new Error('VALIDATION_POST_CREATE_FAILED');
    }

    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'post_create');
    // Connect returns a single post object; the client only needs an id.
    const responseBody = { id: created[0].id, created, errors };

    // Persist the whole body, partial failures included. A replay has to be
    // byte-identical, and a client retrying after a partial failure must not
    // double-create the destinations that already succeeded.
    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 201, responseBody);
    }

    return Response.json(responseBody, { status: 201, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 100);
    const cursor = url.searchParams.get('cursor') || undefined;

    // A product-bound key only sees its own product's posts. Applied as a query
    // filter rather than in memory so `limit` counts matching posts — filtering
    // after the fetch could return fewer (or none) while more existed.
    const filters: FieldFilter[] = [];
    if (ctx.productId) filters.push({ field: 'productId', op: '==', value: ctx.productId });

    const page = await executeListQueryPage(
      adminDb.collection(workspaceCollection(ctx.workspaceId, 'posts')),
      { filters, orderByField: 'createdAt', limit, cursor },
    );

    const data = page.items.map((p) => {
      const mediaUrls = Array.isArray(p.mediaUrls) ? (p.mediaUrls as unknown[]).map(String) : [];
      const status = mapPostStatus(p.status);
      return {
        id: p.id,
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

    return Response.json({ data, next_cursor: page.nextCursor }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
