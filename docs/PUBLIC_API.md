# Markaestro Public API v1

Public API v1 supports image-first publishing automation for:
- Facebook
- Instagram
- TikTok image posts and carousels

## Scope

- Image upload to Markaestro storage
- Post creation in the workspace's canonical `posts` collection
- Async publish runs
- Signed webhook delivery

Excluded from v1:
- TikTok video
- ads
- mixed image/video payloads

## Channel rules

- Facebook: text-only or image posts, max 10 images
- Instagram: requires at least 1 image, max 10 images
- TikTok: requires at least 1 image, max 10 images, exports for creator review instead of direct publish

## Auth

Use a workspace API key:

`Authorization: Bearer mk_live_<workspaceId>.<clientId>.<secret>`

Manage API keys from:
- `/settings?tab=api`

## Main endpoints

- `POST /api/public/v1/media`
- `POST /api/public/v1/posts`
- `GET /api/public/v1/posts/:id`
- `POST /api/public/v1/posts/:id/publish`
- `GET /api/public/v1/job-runs/:id`
- `POST /api/public/v1/webhook-endpoints`
- `GET /api/public/v1/webhook-endpoints`
- `DELETE /api/public/v1/webhook-endpoints/:id`

## Publish behavior

Meta:
- direct publish
- post status becomes `published`

TikTok:
- exported to review flow using TikTok's media-upload mode
- post status becomes `exported_for_review`
- response includes `nextAction=open_tiktok_inbox_and_complete_editing`

## Example flow

1. Upload media

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/media" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: upload-001" \
  -F "file=@launch-1.jpg"
```

2. Create post

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: post-001" \
  -d '{
    "channel": "instagram",
    "caption": "Launch day.",
    "mediaAssetIds": ["ast_123", "ast_124"]
  }'
```

3. Queue publish

```bash
curl -X POST "$MARKAESTRO_URL/api/public/v1/posts/pst_123/publish" \
  -H "Authorization: Bearer $MARKAESTRO_API_KEY" \
  -H "Idempotency-Key: publish-001"
```

4. Poll the run or consume webhooks

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

Headers:
- `X-Markaestro-Event`
- `X-Markaestro-Timestamp`
- `X-Markaestro-Signature`

Webhook secrets are shown once at creation time and stored hashed at rest.
