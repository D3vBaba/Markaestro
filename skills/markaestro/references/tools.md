# Markaestro MCP tools

Every tool returns JSON text. Failures come back as an error result whose
first line is `CODE (HTTP status): message`, followed by per-channel issues
and a hint. Ids are opaque strings; copy them exactly.

## Discovery

**`get_channel_rules`** `{}` → `{ rules, keyMode: "live" | "test", baseUrl }`

**`list_products`** `{}` → `{ products: [{ id, name, channels: [...] }], count }`
The list has one entry: the brand this key is bound to.

**`list_destinations`** `{ productId }` →
`{ destinations: [{ id, channel, provider, label, deliveryMode, ... }], count }`
Needed only when one channel has several accounts (two Facebook Pages, say).

## Posts

**`list_posts`** `{ status?, limit? (1-100), cursor? }` → `{ posts: [...], nextCursor }`
Statuses: `draft`, `scheduled`, `publishing`, `published`,
`platform_action_required`, `failed`, `partial_failed`.

**`get_post`** `{ postId }` → `{ post }`
A post carries `status`, `caption`, `targets[]`, `mediaAssetIds`,
`scheduledAt`, `publishedAt`, `externalUrl`, `publishResults[]`, `nextAction`.

**`create_post`**
```json
{
  "caption": "Launch day.",
  "targets": [
    { "channel": "linkedin" },
    { "channel": "instagram", "deliveryMode": "direct_publish",
      "settings": { "__type": "instagram", "postType": "feed" } }
  ],
  "mediaAssetIds": ["ast_123"],
  "scheduledAt": "2026-09-10T14:00:00Z"
}
```
→ `{ post, note }`. Without `scheduledAt` the post is a draft. For one channel
use `channel` (plus optional `destinationId`, `deliveryMode`, `settings`)
instead of `targets`. Never send both.

**`create_posts`** `{ posts: [ ...up to 25 create_post bodies ] }` →
`{ results: [{ ok, post } | { ok: false, error }], created, total }`

**`publish_post`** `{ postId }` → `{ run: { id, status, ... } }`
Publishes now. Poll `get_job_run` with `run.id`.

**`delete_post`** `{ postId }` → `{ deleted: true, id }`
Cancels a scheduled post or removes a draft. A published post is only
forgotten by Markaestro; the live copy stays on the platform.

**`bulk_posts`**
`{ ids: [...], action: "reschedule", scheduledAt }` or
`{ ids, action: "delete" }` or `{ ids, action: "status", status: "draft" | "scheduled" }`
→ `{ succeeded: [ids], failed: [{ id, error }] }`

## Media

**`upload_media`** `{ source, fileName?, contentType? }` → `{ asset: { id, type, url, width, height, ... } }`
`source` is a local path, an http(s) URL, or a `data:` URL. The type is
inferred from the extension when `contentType` is omitted.

**`list_media`** `{ type?: "image" | "video", limit?, cursor? }` → `{ assets: [...], nextCursor }`

**`get_media`** `{ assetId }` → `{ asset }` with `processingState` and `refCount`.

## Publish runs

**`get_job_run`** `{ runId }` → `{ run: { status: queued | running | succeeded | failed, message, details } }`

**`list_job_runs`** `{ status?, resourceId? (a post id), limit?, cursor? }` → `{ runs: [...], nextCursor }`

## Webhooks (needs the `webhooks.manage` scope)

**`list_webhook_endpoints`** `{}` → `{ webhookEndpoints: [...] }`

**`create_webhook_endpoint`** `{ url, events: ["post.published", ...] }` →
`{ webhookEndpoint: { id, secret, ... } }`. The secret is shown once.
