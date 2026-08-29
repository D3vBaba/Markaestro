# Markaestro Public API v1

Markaestro exposes two surfaces over the same workspace, auth, products, and
publishing pipeline:

- **[Connect API](#connect-api-compatibility-surface) (`/api/connect/v1`) —
  recommended.** A small, flat, snake_case surface most scheduling clients can
  target as-is. Start here.
- **Public API v1 (`/api/public/v1`) — advanced.** Full control: explicit
  publish, async job runs, signed webhooks, batch create, per-channel settings.
  Documented below.

Both support Facebook, Instagram, TikTok, and Threads. **Each channel is its own
dedicated destination** — publishing to one never fans out to another (linking a
Meta connection no longer co-publishes Facebook + Instagram). **API create is
draft-first** on either surface: `POST /posts` stores drafts for the selected
product destination. Publish explicitly later from Markaestro or, where allowed,
through the public publish endpoint.

## Scope

- Image and video upload to Markaestro storage (direct or compatibility multipart)
- Post creation in the workspace's canonical `posts` collection
- Async publish runs
- Signed webhook delivery

## Channel rules

- Facebook: text-only, image, or video posts; max 10 images; 1 video per post
- Instagram: requires at least 1 media item (image or video); max 10 items; single video publishes as a Reel; carousels support mixed image/video
- TikTok: requires at least 1 media item; either 1 video or up to 10 images. API create always stores a draft. Explicit publish defaults to TikTok's inbox handoff (`platform_inbox`), where the creator finalizes and posts inside TikTok. Direct Post — publishing straight to the creator's profile — is opt-in per post via `settings.postMode: "direct_post"` and requires an explicit `privacyLevel`; see [Platform-specific settings](#platform-specific-settings).

## Media upload

Accepted image types: `image/png`, `image/jpeg`, `image/webp`, `image/gif` (max 10 MB)

Accepted video types: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo`, `video/x-matroska` (max 250 MB)

Each upload counts against the workspace's monthly `mediaUploads`
quota (shared with in-app uploads). When the quota is exhausted, the
endpoint returns `402` with `error: "QUOTA_EXCEEDED_MEDIA_UPLOADS"`.

For new integrations, use the three-step direct upload flow: create an upload
session, `PUT` the bytes straight to the returned Cloud Storage URL, then
finalize the session. This keeps large files out of the application runtime.
The multipart endpoint remains supported for existing clients.
Creating a public upload session reserves one monthly media-upload unit before
the signed URL is issued. An abandoned session still consumes that unit; its
staged object is removed by the Storage lifecycle policy.

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
- `GET /api/public/v1/posts` returns only that product's posts. The optional
  `?productId=` filter may name the key's own product (same result) but is
  rejected with `FORBIDDEN` for any other.
- `GET /api/public/v1/posts/:id`, `DELETE /api/public/v1/posts/:id`,
  `POST /api/public/v1/posts/:id/publish`, and `GET /api/public/v1/job-runs/:id`
  answer `404 NOT_FOUND` for anything outside the key's product — `404` rather
  than `403` so a key cannot probe for ids it doesn't own. A job run inherits
  the product of the post it acts on.
- Naming a different product (a `productId` for another product) is rejected
  with `VALIDATION_PRODUCT_SCOPE_MISMATCH`.

Because each key is pinned to one product, **listing what is scheduled across
several brands means one call per key**, not one call with a filter.

The binding is enforced at authentication, not just at creation. A key with no
product binding — only possible for keys issued before binding was required —
is refused with `403 API_KEY_NOT_BOUND_TO_PRODUCT`. Replace it with a new key
from Settings → API, which binds it to one brand.

A workspace can have many products, and the same social account can belong to
more than one — binding keeps each key cleanly isolated to one. To publish for
several products, create one key per product.

## Main endpoints

- `GET /api/public/v1/products`
- `GET /api/public/v1/products/:id/destinations`
- `POST /api/public/v1/media/upload-sessions` — create a direct upload session
- `PUT <uploadUrl>` — upload bytes directly to storage
- `POST /api/public/v1/media/upload-sessions/:id/finalize` — verify and create the asset
- `POST /api/public/v1/media` — compatibility multipart upload
- `POST /api/public/v1/posts`
- `GET /api/public/v1/posts` — `?status=`, `?productId=`, `?limit=` (max 100)
- `GET /api/public/v1/posts/:id`
- `DELETE /api/public/v1/posts/:id`
- `POST /api/public/v1/posts/:id/publish`
- `GET /api/public/v1/job-runs/:id`
- `POST /api/public/v1/webhook-endpoints`
- `GET /api/public/v1/webhook-endpoints`
- `DELETE /api/public/v1/webhook-endpoints/:id`
- `GET /api/public/v1/webhook-endpoints/:id/deliveries` — `?cursor=`, `?limit=` (max 100)

<!-- generated:endpoints:start -->

<!-- Generated by scripts/generate-api-docs.mjs from the OpenAPI document.
     Do not edit between these markers; run `npm run docs:api` instead. -->

### Endpoint reference

Generated from the [OpenAPI description](/api/public/v1/openapi.json), which is itself generated from the schemas the routes validate against. 10 paths.

| Endpoint | What it does | Query parameters |
| --- | --- | --- |
| `GET /api/public/v1/posts` | List posts | `limit`, `cursor`, `status`, `productId` |
| `POST /api/public/v1/posts` | Create a post | n/a |
| `GET /api/public/v1/posts/{id}` | Get a post | n/a |
| `DELETE /api/public/v1/posts/{id}` | Delete a post | n/a |
| `POST /api/public/v1/posts/{id}/publish` | Publish a post | n/a |
| `POST /api/public/v1/posts/bulk` | Reschedule, delete, or restatus up to 25 posts | n/a |
| `GET /api/public/v1/media` | List media assets | `limit`, `cursor`, `type` |
| `POST /api/public/v1/media` | Upload a media asset | n/a |
| `GET /api/public/v1/media/{id}` | Get a media asset | n/a |
| `DELETE /api/public/v1/media/{id}` | Delete a media asset and release its storage | n/a |
| `POST /api/public/v1/media/upload-sessions` | Start a direct-to-storage upload | n/a |
| `GET /api/public/v1/job-runs` | List job runs | `limit`, `cursor`, `status`, `resourceId` |
| `GET /api/public/v1/job-runs/{id}` | Get a job run | n/a |
| `GET /api/public/v1/webhook-endpoints` | List webhook endpoints | n/a |
| `POST /api/public/v1/webhook-endpoints` | Register a webhook endpoint | n/a |

### Retryable errors

An identical retry can plausibly succeed for these codes and only these. For everything else, change something first.

- `VALIDATION_POST_ALREADY_PUBLISHING` (400): A publish run for this post is already in flight. Wait for it to settle.
- `VALIDATION_POST_IS_PUBLISHING` (400): The post is being published right now and cannot be edited or deleted until the run settles.
- `OTP_COOLDOWN` (429): A sign-in code was requested too recently. Wait before requesting another.
- `RATE_LIMITED` (429): The rate limit for this key or route was exceeded. `Retry-After` and the `X-RateLimit-*` headers say when to try again.
- `RATE_LIMITED_CHANNEL` (429): This channel has hit its hourly publish ceiling for the workspace. The response names the channel and how long to wait.
- `EMAIL_SEND_FAILED` (500): The transactional email provider rejected the send.
- `INTERNAL_ERROR` (500): An unhandled failure. The `requestId` in the body identifies the request in the server logs.
- `MALFORMED_RESPONSE` (500): Synthesised by the client when a response body will not parse (a proxy error page, a truncated body).
- `REQUEST_TIMEOUT` (500): An upstream request exceeded its deadline.
- `VERTEX_AI_EMPTY_RESPONSE` (500): The model returned no content. The AI operation is refunded.
- `VERTEX_AI_INVALID_JSON` (500): The model returned content that did not parse against the response schema. The AI operation is refunded.
- `VERTEX_UNAVAILABLE` (500): The model backend was unavailable. The AI operation is refunded, so an identical retry is safe.

The full catalogue, 163 codes with statuses and meanings, is in the OpenAPI description under **Errors**.

<!-- generated:endpoints:end -->

### Webhook delivery history

`GET /api/public/v1/webhook-endpoints/:id/deliveries` returns the attempts made
against one endpoint, newest first, so an integration can see for itself
whether its receiver has been rejecting events:

```json
{
  "data": [
    {
      "id": "del_...",
      "eventType": "post.published",
      "status": "failed",
      "attemptCount": 5,
      "responseCode": 500,
      "lastError": "Webhook responded 500",
      "createdAt": "2026-08-29T10:00:00.000Z",
      "lastAttemptAt": "2026-08-29T11:04:00.000Z",
      "nextAttemptAt": null
    }
  ],
  "nextCursor": null
}
```

`status` is `pending`, `retrying`, `delivered`, `dead_letter`, or `failed`.
`dead_letter` means retries are exhausted (six attempts over roughly a day,
with jitter); the delivery stays replayable for 7 days from the endpoint's
settings, individually or in bulk, and a replay resets the attempt counter.
`failed` means the endpoint itself was gone. An endpoint that fails 10
consecutive attempts is deferred to one slow probe every 15 minutes until a
delivery succeeds, so a dead receiver does not consume the whole delivery
budget. `lastError` is truncated, and the delivered payload is deliberately
not echoed back (your endpoint already received it).

Requires the `webhooks.manage` scope.

> **Connecting an off-the-shelf scheduling client** that speaks the common
> snake_case `create-upload-url → PUT → post` convention? See the
> [Connect API](#connect-api-compatibility-surface) — a drop-in compatibility
> surface over these same endpoints (point the client's base at
> `<host>/api/connect`).

## Idempotency

Send `Idempotency-Key` (any string up to 500 characters, no control bytes)
on **any mutating request**, on both surfaces: post and batch create,
publish, bulk operations, media upload and upload sessions, webhook endpoint
create, and both DELETEs. Semantics, precisely:

- A replay with the same key and the same body returns the original
  response verbatim (partial-failure lists included), within 24 hours.
- The same key with a **different** body is refused with
  `409 VALIDATION_IDEMPOTENCY_KEY_REUSED`, never silently replayed.
- A key whose first request is still running answers
  `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` with `Retry-After: 1`.

The SDKs mint a key automatically on every mutation.

## Publish behavior

> These defaults apply to the native `/api/public/v1` surface. Posts created
> through the [Connect API](#connect-api-compatibility-surface) always opt into
> API publishing instead.

Delivery modes (`deliveryMode` on create, optional):
- `manual_reminder` — **default for `facebook`, `instagram`, and `tiktok`.** The
  server never calls the platform API for the post. Publishing moves it to
  `platform_action_required` with `nextAction: "post_manually_from_reminder"`;
  the workspace user downloads the media, posts natively themselves, and
  confirms in the app. No connected platform account or destination is
  required to create or publish these posts (a destination is still attached
  when one is configured, for attribution).
- `direct_publish` — official platform API publishing. Default for `threads`,
  `linkedin`, and `pinterest`; Meta channels accept it as an explicit opt-in.
  Requires a connected destination. On `tiktok` it maps to `platform_inbox`
  (TikTok's only API-publishing path).
- `platform_inbox` — TikTok inbox handoff only; rejected on other channels
  with `VALIDATION_DELIVERY_MODE_NOT_SUPPORTED_FOR_CHANNEL`.

Manual reminder (`manual_reminder`):
- `POST /api/public/v1/posts/:id/publish` queues the post into the manual
  posting queue instead of contacting any platform
- the post lands in `platform_action_required` and a `post.action_required`
  webhook fires
- the post becomes `published` only after the workspace user confirms they
  posted it natively

Meta (with explicit `deliveryMode: "direct_publish"`):
- direct publish for the selected Facebook Page destination
- no automatic fan-out to Instagram; create a separate Instagram post for an Instagram destination
- post status becomes `published`

Instagram Login (with explicit `deliveryMode: "direct_publish"`):
- direct publish for standalone Instagram professional accounts
- exposed as a separate destination in `GET /api/public/v1/products/:id/destinations`

Meta account selection:
- Use `GET /api/public/v1/products` to discover product ids
- Use `GET /api/public/v1/products/:id/destinations` to inspect linked Facebook, Instagram, and TikTok destinations for that product
- Omit `productId` to use the API key's bound product, or send that same id explicitly; another product id is rejected
- Include `destinationId` when the chosen product has more than one eligible destination for the chosen channel
- Facebook-only products work
- Products with both Facebook and Instagram connections expose separate destinations
- Standalone Instagram professional accounts are supported through Instagram Login and do not require a Facebook Page

TikTok (draft-first; manual reminder by default, inbox handoff on opt-in):
- by default (`manual_reminder`) publishing a TikTok post never calls the
  TikTok API — the user posts natively from the reminder queue
- the behavior below applies when the post opted into API publishing
  (`deliveryMode: "direct_publish"` or `"platform_inbox"`):
- products expose TikTok destinations only when a TikTok publishing connection is configured
- the TikTok destination returned by `GET /api/public/v1/products/:id/destinations` represents the connected TikTok account
- TikTok destinations use `deliveryMode: "platform_inbox"` to make the inbox handoff explicit
- Public API creates remain **draft-first**. Connect clients can explicitly schedule by sending `is_draft=false` with `scheduled_at`; TikTok schedules the creator-inbox handoff, while supported direct channels use their official publishing path.
- `POST /api/public/v1/posts/:id/publish` queues the same TikTok publish path the app uses — the inbox handoff unless the post carries `settings.postMode: "direct_post"`
- once TikTok confirms `SEND_TO_USER_INBOX`, the post becomes `platform_action_required`; the creator opens TikTok to finalize caption/privacy and post
- a Direct Post skips that step: it goes to `published` when TikTok reports `PUBLISH_COMPLETE`, with no action left for the creator

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
# 3a. Create a direct upload session. The declared type and size must exactly
# match the file sent in the next step.
UPLOAD=$(curl -s -X POST "$MARKAESTRO_URL/api/public/v1/media/upload-sessions" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "launch-1.jpg",
    "contentType": "image/jpeg",
    "sizeBytes": 184320
  }')
UPLOAD_URL=$(printf '%s' "$UPLOAD" | jq -r '.uploadSession.uploadUrl')
UPLOAD_SESSION_ID=$(printf '%s' "$UPLOAD" | jq -r '.uploadSession.id')

# 3b. PUT the raw bytes to uploadSession.uploadUrl. Do not send the API key to
# the storage URL. The signed URL expires after 15 minutes.
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary @launch-1.jpg

# 3c. Finalize with uploadSession.id. Returns { "asset": { "id": "ast_…", … } }.
curl -X POST "$MARKAESTRO_URL/api/public/v1/media/upload-sessions/$UPLOAD_SESSION_ID/finalize" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

`POST /media/upload-sessions` returns:

```json
{
  "uploadSession": {
    "id": "ast_123",
    "assetId": "ast_123",
    "uploadUrl": "https://storage.googleapis.com/…",
    "uploadMethod": "PUT",
    "uploadHeaders": { "Content-Type": "image/jpeg" },
    "expiresAt": "2026-08-18T12:15:00.000Z"
  }
}
```

Session creation reserves the media-upload quota. Finalization is retry-safe: a completed session returns the same asset. A
concurrent finalization returns `409 UPLOAD_FINALIZATION_IN_PROGRESS`. New
clients should retry that response with backoff. If direct upload is not
practical, the compatibility multipart endpoint is still available:

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: upload-legacy-001" \
  -F "file=@launch-1.jpg"
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

`deliveryMode` may be added to the body. Omitted, Instagram defaults to
`manual_reminder` (no Instagram API call is ever made for the post; the
workspace user posts it natively from the reminder queue). Pass
`"deliveryMode": "direct_publish"` to opt this post into official-API
publishing instead.

### Platform-specific settings

`settings` is a discriminated union — `__type` MUST equal the post's `channel`.
Settings carried on a post are persisted verbatim and read by the adapter at
publish time. Unrecognized fields are rejected by validation.

**TikTok** (`__type: "tiktok"`)
- `postMode`: `"inbox"` (default) · `"direct_post"`
- `privacyLevel`: `"PUBLIC_TO_EVERYONE"` · `"MUTUAL_FOLLOW_FRIENDS"` · `"FOLLOWER_OF_CREATOR"` · `"SELF_ONLY"`
- `disableComment`, `disableDuet`, `disableStitch`: boolean
- `commercialContentDisclosure`, `brandOrganicToggle`, `brandContentToggle`: boolean
- `photoCoverIndex`: integer 0–9 (photo carousels)

`postMode` selects the publishing flow. Omitting it keeps the inbox handoff.

> **`"inbox"`** — content lands in the creator's TikTok inbox and they finalize
> it in the TikTok app. `privacyLevel` and the `disable*` / disclosure fields
> are accepted but not honored, because TikTok ignores them in this mode and
> the creator sets them itself. `photoCoverIndex` is honored.

> **`"direct_post"`** — publishes straight to the creator's profile, so every
> field above is honored and validated against a live `creator_info` query at
> publish time. `privacyLevel` is **required** and must be one of the levels
> the account currently offers. Rules TikTok enforces, rejected before
> anything is uploaded:
> - `brandContentToggle: true` cannot be combined with `privacyLevel: "SELF_ONLY"`
> - `commercialContentDisclosure: true` requires `brandOrganicToggle` or `brandContentToggle`
> - `disable*: false` is rejected when the account itself has that ability turned off
>
> Direct Post is gated on TikTok's Content Posting API audit. Until it passes,
> TikTok forces every post from the client to `SELF_ONLY` regardless of the
> `privacyLevel` sent.
> See [TikTok's Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).

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

## Reviewing and cancelling the schedule

Listing uses `posts.read` and deleting uses `posts.write` — no new scope, so
keys issued before these existed can call both without being reissued.

```bash
# What is queued for this key's brand, newest first
curl "$MARKAESTRO_URL/api/public/v1/posts?status=scheduled&limit=100" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"

# Cancel one
curl -X DELETE "$MARKAESTRO_URL/api/public/v1/posts/pst_123" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

```json
{ "deleted": true, "id": "pst_123" }
```

`status` matches one value — use `scheduled` for the queue, `draft`,
`published`, `failed`, and so on for the rest. Every post carries `productId`,
  and a product-bound key only returns posts for its own brand.

Deleting removes the post from Markaestro only:

- A **published** post can be deleted, but its live platform copy stays up —
  Markaestro just stops tracking it. Retract it on the platform itself.
- A post **mid-publish** is refused with `400 VALIDATION_POST_IS_PUBLISHING`.
  Deleting then would let the in-flight run publish anyway, leaving a live post
  with no record. Wait for it to settle, then delete.
- A **scheduled** post drops out of the publish sweep immediately; the
  scheduler selects by status and due time, so no orphaned job remains.

## Webhooks

Supported events:
- `post.publish.queued`
- `post.published`
- `post.action_required`
- `post.failed`

TikTok webhook semantics:
- `post.action_required` means the post has been handed off to the creator's TikTok inbox and is ready for them to finish inside TikTok
- it does not mean the post has been publicly published yet
- payloads include `nextAction=open_tiktok_inbox_and_complete_posting`

Headers:

| Header | Contents |
| --- | --- |
| `X-Markaestro-Event` | The event type, for routing before you parse the body. |
| `X-Markaestro-Timestamp` | ISO 8601, when the payload was signed. Part of the signed string. |
| `X-Markaestro-Signature` | Hex HMAC-SHA256, signed with the endpoint's current secret. |
| `X-Markaestro-Signature-Previous` | Present only during a rotation grace window, signed with the superseded secret. |

Webhook secrets are shown once at creation time and stored hashed at rest.
Each workspace may have up to 25 active webhook endpoints. Creating another
returns `409 WEBHOOK_ENDPOINT_LIMIT_REACHED`; disable an old endpoint first.

## Verifying a webhook

The signed string is the timestamp, a literal `.`, and the **raw request
body**, in that order:

```
<X-Markaestro-Timestamp> + "." + <raw body bytes>
```

Signed with HMAC-SHA256 using your endpoint secret, hex encoded. Three things
matter and each has bitten someone:

1. **Sign the raw body, not a re-serialized object.** `JSON.parse` followed by
   `JSON.stringify` can reorder keys or change number formatting, and the
   signature will not match. Capture the bytes before your framework parses
   them.
2. **Compare in constant time.** A plain `===` leaks the correct signature one
   byte at a time to anyone willing to measure.
3. **Reject an old timestamp.** Five minutes is a reasonable window. Without
   it, a captured payload can be replayed forever.

During a secret rotation, both `X-Markaestro-Signature` and
`X-Markaestro-Signature-Previous` are sent. Accept the request if **either**
verifies, and you can redeploy with the new secret at your own pace.

### Node

```js
import crypto from 'node:crypto';

export function verify(rawBody, headers, secret) {
  const timestamp = headers['x-markaestro-timestamp'];
  if (!timestamp) return false;

  // Reject replays of a captured payload.
  const age = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  // Both signatures are sent during a rotation grace window; either is valid.
  return [headers['x-markaestro-signature'], headers['x-markaestro-signature-previous']]
    .filter(Boolean)
    .some((candidate) => {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(candidate, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}
```

### Python

```python
import hmac, hashlib, time
from datetime import datetime, timezone

def verify(raw_body: bytes, headers: dict, secret: str) -> bool:
    timestamp = headers.get("x-markaestro-timestamp")
    if not timestamp:
        return False

    signed_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if time.time() - signed_at.timestamp() > 300:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()

    candidates = [
        headers.get("x-markaestro-signature"),
        headers.get("x-markaestro-signature-previous"),
    ]
    return any(c and hmac.compare_digest(expected, c) for c in candidates)
```

### Ruby

```ruby
require 'openssl'
require 'time'

def verify(raw_body, headers, secret)
  timestamp = headers['x-markaestro-timestamp']
  return false unless timestamp
  return false if Time.now - Time.iso8601(timestamp) > 300

  expected = OpenSSL::HMAC.hexdigest('SHA256', secret, "#{timestamp}.#{raw_body}")
  [headers['x-markaestro-signature'], headers['x-markaestro-signature-previous']]
    .compact
    .any? { |candidate| OpenSSL.secure_compare(expected, candidate) }
end
```

### PHP

```php
function markaestro_verify(string $rawBody, array $headers, string $secret): bool {
    $timestamp = $headers['x-markaestro-timestamp'] ?? null;
    if (!$timestamp) return false;
    if (time() - strtotime($timestamp) > 300) return false;

    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    foreach (['x-markaestro-signature', 'x-markaestro-signature-previous'] as $header) {
        if (isset($headers[$header]) && hash_equals($expected, $headers[$header])) {
            return true;
        }
    }
    return false;
}
```

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
| `GET /api/connect/v1/posts` | `?limit=`, `?cursor=` | `{ data: [ post… ], next_cursor }` |
| `GET /api/connect/v1/media` | `?limit=`, `?cursor=` | `{ data: [ { id, object: { url }, url, type, mime_type, size_bytes, width, height, created_at } ], next_cursor }` |

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

**Facebook / Instagram / TikTok / Threads** destinations are exposed, each as
its own dedicated path — publishing to one never fans out to another.

## Media upload

Two-step, S3-style presigned flow:

1. `POST /media/create-upload-url` with `{ mime_type, size_bytes, name }` →
   returns `{ media_id, upload_url }`.
2. `PUT` the raw bytes to `upload_url` (set `Content-Type`). The URL is
   single-use, bound to that one `media_id`, and **expires after 15 minutes**.

Accepted: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, max 10 MB. The
resulting `media_id` is a normal Markaestro media asset usable in `POST /posts`.

## Post status & scheduling

`status` on a returned post is one of `draft` · `processing` · `posted` ·
`failed` (mapped from native statuses). Create is draft-first:

- `POST /api/connect/v1/posts` is draft-first by default.
- When `is_draft=false` and a valid ISO `scheduled_at` are both supplied, the
  created posts are scheduled for that time. Any other combination remains a
  draft.
- Publish from the Markaestro app or a supported explicit publish endpoint.
- **Connect posts always use API publishing**, whether scheduled up front or
  saved as a draft and published later: `direct_publish` on Facebook,
  Instagram, and LinkedIn, and `platform_inbox` (the creator-inbox handoff) on
  TikTok. This differs from the native public API, where Meta and TikTok
  channels default to `manual_reminder` and the client opts in per post. A
  Connect client is an explicit publishing integration, so it opts in for
  every post it creates.
- Publishing a Connect post therefore requires a connected destination for
  that channel.

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

# 3. Create the post draft
curl -X POST "$MARKAESTRO_URL/api/connect/v1/posts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "New drop 🔥",
    "media": ["ast_111", "ast_222"],
    "social_accounts": ["prod_123#instagram:instagram:ig_123"]
  }'

# 4. List posts and their status
curl "$MARKAESTRO_URL/api/connect/v1/posts?limit=20" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY"
```

## Limitations

- **Publishing-only surface** — the Connect API exposes account discovery,
  media upload, post creation, and post status. It does not expose engagement
  metrics or provider insights.
- For richer control (per-channel `settings`, batch create, explicit publish,
  job-run polling, webhooks), use the native `/api/public/v1` endpoints.
