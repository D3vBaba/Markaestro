# Markaestro Public API v1

Public API v1 supports publishing automation (images and video) for:
- Facebook
- Instagram
- TikTok

## Scope

- Image and video upload to Markaestro storage
- Post creation in the workspace's canonical `posts` collection
- Async publish runs
- Signed webhook delivery

## Channel rules

- Facebook: text-only, image, or video posts; max 10 images; 1 video per post
- Instagram: requires at least 1 media item (image or video); max 10 items; single video publishes as a Reel; carousels support mixed image/video
- TikTok: requires at least 1 media item; either 1 video or up to 10 images; publish requests use the same direct inbox handoff as the app and become `exported_for_review` once TikTok finishes processing

## Media upload

Accepted image types: `image/png`, `image/jpeg`, `image/webp`, `image/gif` (max 10 MB)

Accepted video types: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo`, `video/x-matroska` (max 250 MB)

Each upload counts against the workspace's monthly `mediaUploads`
quota (shared with in-app uploads). When the quota is exhausted, the
endpoint returns `402` with `error: "QUOTA_EXCEEDED_MEDIA_UPLOADS"`.

## Auth

Use a workspace API key:

`Authorization: Bearer mk_live_<workspaceId>.<clientId>.<secret>`

Manage API keys from:
- `/settings?tab=api`

## Scope by product

Every API key is **bound to exactly one product**, chosen when the key is
created (Settings → API). A key only ever operates within its product:

- The key auto-targets its product, so you **don't pass `productId`** when
  creating posts. You may still pass `destinationId` when the product has more
  than one destination for the channel.
- `GET /api/public/v1/products` returns just the key's product, and
  `GET /api/public/v1/products/:id/destinations` works only for it.
- `GET /api/public/v1/posts` returns only that product's posts.
- Naming a different product (a `productId` for another product) is rejected
  with `VALIDATION_PRODUCT_SCOPE_MISMATCH`.

A workspace can have many products, and the same social account can belong to
more than one — binding keeps each key cleanly isolated to one. To publish for
several products, create one key per product.

## Main endpoints

- `GET /api/public/v1/products`
- `GET /api/public/v1/products/:id/destinations`
- `POST /api/public/v1/media`
- `POST /api/public/v1/posts`
- `GET /api/public/v1/posts/:id`
- `POST /api/public/v1/posts/:id/publish`
- `GET /api/public/v1/job-runs/:id`
- `POST /api/public/v1/webhook-endpoints`
- `GET /api/public/v1/webhook-endpoints`
- `DELETE /api/public/v1/webhook-endpoints/:id`

> **Connecting an off-the-shelf scheduling client** that speaks the common
> snake_case `create-upload-url → PUT → post` convention? See the
> [Connect API](#connect-api-compatibility-surface) — a drop-in compatibility
> surface over these same endpoints (point the client's base at
> `<host>/api/connect`).

## Publish behavior

Meta:
- direct publish
- if a selected Facebook Page has a linked Instagram business account, Markaestro fans the publish out to both Facebook and Instagram
- post status becomes `published`

Instagram Login:
- direct publish for standalone Instagram professional accounts that are not linked to a Facebook Page
- exposed as a separate destination in `GET /api/public/v1/products/:id/destinations`
- if a product has both a Meta-linked Instagram destination and a standalone Instagram Login destination, include `destinationId` when creating the post

Meta account selection:
- Use `GET /api/public/v1/products` to discover product ids
- Use `GET /api/public/v1/products/:id/destinations` to inspect linked Facebook, Instagram, and TikTok destinations for that product
- Include `productId` when your workspace has more than one eligible product for the chosen channel
- Include `destinationId` when the chosen product has more than one eligible destination for the chosen channel
- Facebook-only products work
- Products with a Facebook Page linked to Instagram will publish to both channels
- Standalone Instagram professional accounts are supported through Instagram Login and do not require a Facebook Page

TikTok:
- products expose TikTok destinations only when a TikTok publishing connection is configured
- the TikTok destination returned by `GET /api/public/v1/products/:id/destinations` represents the connected TikTok account
- `POST /api/public/v1/posts/:id/publish` follows the same inbox handoff as the Markaestro app: the publish worker pushes media to TikTok, keeps the job open, and polls TikTok until it reports `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, or `FAILED`
- once TikTok confirms inbox delivery, post status becomes `exported_for_review`
- `externalId` contains the TikTok `publish_id`
- the follow-up action is `nextAction=open_tiktok_inbox_and_complete_editing`

## Example flow

1. List products

```bash
curl "$MARKAESTRO_URL/api/public/v1/products" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

2. Inspect destinations

```bash
curl "$MARKAESTRO_URL/api/public/v1/products/prod_123/destinations" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

3. Upload media (image or video)

```bash
# Image upload
curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: upload-001" \
  -F "file=@launch-1.jpg"

# Video upload
curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: upload-002" \
  -F "file=@product-demo.mp4"
```

4. Create post

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: post-001" \
  -d '{
    "channel": "instagram",
    "caption": "Launch day.",
    "mediaAssetIds": ["ast_123", "ast_124"],
    "productId": "prod_123",
    "destinationId": "instagram:instagram:ig_123",
    "settings": {
      "__type": "instagram",
      "postType": "feed",
      "collaborators": ["partnerbrand"],
      "altText": ["Front view of launch product", "Detail shot"]
    }
  }'
```

### Platform-specific settings

`settings` is a discriminated union — `__type` MUST equal the post's `channel`.
Settings carried on a post are persisted verbatim and read by the adapter at
publish time. Unrecognized fields are rejected by validation.

**TikTok** (`__type: "tiktok"`)
- `privacyLevel`: `"PUBLIC_TO_EVERYONE"` · `"MUTUAL_FOLLOW_FRIENDS"` · `"FOLLOWER_OF_CREATOR"` · `"SELF_ONLY"`
- `disableComment`, `disableDuet`, `disableStitch`: boolean
- `photoCoverIndex`: integer 0–9 (photo carousels)

> Privacy and comment/duet/stitch toggles take effect once TikTok approves the
> workspace for Direct Post mode. Markaestro publishes via MEDIA_UPLOAD inbox
> handoff today, so these fields are accepted at the API boundary and
> available to the publisher but the creator finalizes them inside TikTok.
> `photoCoverIndex` is honored today.

**Instagram** (`__type: "instagram"`)
- `postType`: `"feed"` · `"reel"` · `"story"` (stories: single image/video only, no carousels)
- `collaborators`: up to 3 IG usernames
- `altText`: per-media accessibility text (parallel to `mediaAssetIds`)

### Batch create

Submit `{ "posts": [ ... ] }` (1–25 items) to create many posts in a single
request. The response is `200` with per-item results — individual failures do
NOT fail the whole call. `Idempotency-Key` covers the whole batch (the
request hash is derived from the full payload).

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: batch-001" \
  -d '{
    "posts": [
      { "channel": "facebook",  "caption": "Hello FB",  "mediaAssetIds": ["ast_1"], "productId": "prod_1" },
      { "channel": "instagram", "caption": "Hello IG",  "mediaAssetIds": ["ast_1"], "productId": "prod_1" },
      { "channel": "tiktok",    "caption": "Hello TT",  "mediaAssetIds": ["ast_2"], "productId": "prod_1" }
    ]
  }'
```

Response shape:

```json
{
  "results": [
    { "ok": true,  "post": { "id": "pst_a", "...": "..." } },
    { "ok": true,  "post": { "id": "pst_b", "...": "..." } },
    { "ok": false, "error": "VALIDATION_TIKTOK_REQUIRES_MEDIA" }
  ],
  "created": 2,
  "total": 3
}
```

5. Queue publish

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts/pst_123/publish" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: publish-001"
```

6. Poll the run or consume webhooks

```bash
curl "$MARKAESTRO_URL/api/public/v1/job-runs/run_123" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

## Webhooks

Supported events:
- `post.publish.queued`
- `post.published`
- `post.exported_for_review`
- `post.failed`

TikTok webhook semantics:
- `post.exported_for_review` means the post has been handed off to the creator's TikTok inbox and is ready for them to finish inside TikTok
- it does not mean the post has been publicly published yet
- payloads include `nextAction=open_tiktok_inbox_and_complete_editing`

Headers:
- `X-Markaestro-Event`
- `X-Markaestro-Timestamp`
- `X-Markaestro-Signature`

Webhook secrets are shown once at creation time and stored hashed at rest.

---

# Connect API (compatibility surface)

`/api/connect/v1/*` is a **flat, snake_case integration surface** for external
scheduling clients that speak the common `create-upload-url → PUT bytes →
create post` convention (the shape used by many off-the-shelf scheduling tools).
It is a thin compatibility layer over the native Public API above — same
workspace model, same auth, same publish pipeline and worker — that translates
those conventions onto Markaestro's products/destinations/posts model.

**When to use which:**
- New integration you control end to end → use the native `/api/public/v1`.
- Pointing an existing snake_case scheduling client at Markaestro without
  rewriting it → use `/api/connect/v1` (set the client's API base to
  `<host>/api/connect`).

## Auth

Same workspace API key as the Public API, with scopes `posts.read`,
`posts.write`, `media.write`:

`Authorization: Bearer mk_live_<workspaceId>.<clientId>.<secret>`

The signed media-upload `PUT` (below) is the one exception — it authorizes via a
short-lived signature in the URL and carries no `Authorization` header.

## Endpoints

| Method & path | Body / params | Returns |
| --- | --- | --- |
| `GET /api/connect/v1/social-accounts` | — | `{ data: [ { id, product_id, product, platform, username } ] }` |
| `GET /api/connect/v1/products` | — | `{ data: [ { id, name, channels, accounts[] } ] }` |
| `POST /api/connect/v1/media/create-upload-url` | `{ mime_type, size_bytes, name }` | `{ media_id, upload_url }` |
| `PUT <upload_url>` | raw image bytes, `Content-Type` header | `{ media_id, url }` |
| `POST /api/connect/v1/posts` | `{ caption, media: [media_id…], social_accounts: [id…], scheduled_at, is_draft }` | `{ id, created[], errors[] }` |
| `GET /api/connect/v1/posts` | `?limit=` | `{ data: [ post… ] }` |
| `GET /api/connect/v1/media` | — | `{ data: [] }` (thumbnails are embedded on posts; best-effort) |
| `GET /api/connect/v1/analytics` | — | `{ data: [] }` (reserved — see limitations) |
| `POST /api/connect/v1/analytics/sync` | — | `{ ok: true }` |

## Accounts & targeting

`GET /api/connect/v1/social-accounts` returns one entry per connected,
publishable destination. Each entry carries `product_id` + `product` (name) so
clients can **group and disambiguate** — the same social account can appear
under multiple products with the same `username`. The `id` is an opaque token
that encodes the Markaestro `productId#destinationId` (or a bare `destinationId`
for a single workspace-level destination) — pass it back **verbatim** in
`social_accounts` when creating a post. `POST /posts` fans out one underlying
post per id.

For a product-first picker, `GET /api/connect/v1/products` returns each product
with its accounts nested.

Because every key is bound to a product (see *Scope by product* above), the
Connect `social-accounts`, `products`, and `posts` lists return only that
product, and posting to another product's account is rejected.

Only **Facebook / Instagram / TikTok** destinations are exposed (the channels
with publish support).

## Media upload

Two-step, S3-style presigned flow:

1. `POST /media/create-upload-url` with `{ mime_type, size_bytes, name }` →
   returns `{ media_id, upload_url }`.
2. `PUT` the raw bytes to `upload_url` (set `Content-Type`). The URL is
   single-use, bound to that one `media_id`, and **expires after 15 minutes**.

Accepted: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, max 10 MB. The
resulting `media_id` is a normal Markaestro media asset usable in `POST /posts`.

## Post status & scheduling

`status` on a returned post is one of `draft` · `scheduled` · `processing` ·
`posted` · `failed` (mapped from native statuses). Scheduling:

- `is_draft: true` → created as a **draft** (unscheduled).
- otherwise → **scheduled** at `scheduled_at` (or immediately if omitted) and
  published by the worker, exactly like a native post.

## Example flow

```bash
# 1. Discover connected accounts
curl "$MARKAESTRO_URL/api/connect/v1/social-accounts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
# → { "data": [ { "id": "prod_123#instagram:instagram:ig_123",
#                 "platform": "instagram", "username": "yourbrand" } ] }

# 2. For each image: request an upload URL, then PUT the bytes
RESP=$(curl -s -X POST "$MARKAESTRO_URL/api/connect/v1/media/create-upload-url" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mime_type": "image/png", "size_bytes": 184320, "name": "slide-1.png" }')
# RESP → { "media_id": "ast_…", "upload_url": "https://…/api/connect/v1/media/upload?token=…" }
curl -X PUT "<upload_url>" -H "Content-Type: image/png" --data-binary @slide-1.png

# 3. Create the post (draft or scheduled)
curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "New drop 🔥",
    "media": ["ast_111", "ast_222"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"],
    "scheduled_at": "2026-06-20T17:00:00.000Z",
    "is_draft": false
  }'

# 4. List posts and their status
curl "$MARKAESTRO_URL/api/connect/v1/posts?limit=20" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

## Limitations

- **No live engagement analytics yet** — `GET /analytics` returns an empty set
  and `POST /analytics/sync` is a no-op (kept so clients that poll them don't
  error). Track publish results via `GET /posts` or webhooks instead.
- **Threads / Pinterest are not exposed** through this surface.
- For richer control (per-channel `settings`, batch create, explicit publish,
  job-run polling, webhooks), use the native `/api/public/v1` endpoints.
