# Markaestro Public API v1

Public API v1 supports publishing automation (images and video) for:
- Facebook
- Instagram
- TikTok
- LinkedIn

## Scope

- Image and video upload to Markaestro storage
- Post creation in the workspace's canonical `posts` collection
- Async publish runs
- Signed webhook delivery

## Channel rules

- Facebook: text-only, image, or video posts; max 10 images; 1 video per post
- Instagram: requires at least 1 media item (image or video); max 10 items; single video publishes as a Reel; carousels support mixed image/video
- TikTok: requires at least 1 media item; either 1 video or up to 10 images; publish requests move the post into Markaestro review for manual posting
- LinkedIn: text-only, image, or video posts; max 20 images; 1 video per post

## Media upload

Accepted image types: `image/png`, `image/jpeg`, `image/webp`, `image/gif` (max 10 MB)

Accepted video types: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo`, `video/x-matroska` (max 500 MB)

## Auth

Use a workspace API key:

`Authorization: Bearer mk_live_<workspaceId>.<clientId>.<secret>`

Manage API keys from:
- `/settings?tab=api`

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
- every product exposes a Markaestro-managed TikTok draft destination, even when no TikTok publishing connection is configured
- the TikTok destination returned by `GET /api/public/v1/products/:id/destinations` represents Markaestro's internal review queue, not a provider-side inbox or publish target
- `POST /api/public/v1/posts/:id/publish` does not push content to TikTok; it stages the post for manual review inside Markaestro
- post status becomes `exported_for_review`
- `externalId` and `externalUrl` remain empty in this flow
- response includes `nextAction=open_markaestro_drafts_and_post_manually`

LinkedIn:
- direct publish via the LinkedIn Posts API
- supports text-only, single image, multi-image (up to 20), and single video
- video uploads use binary chunked upload to LinkedIn's `/rest/videos` endpoint
- post status becomes `published`

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
    "destinationId": "instagram:instagram:ig_123"
  }'
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
- `post.exported_for_review` means the post is ready in Markaestro for manual editing/posting
- it does not mean the post was delivered to TikTok
- payloads include `nextAction=open_markaestro_drafts_and_post_manually`

Headers:
- `X-Markaestro-Event`
- `X-Markaestro-Timestamp`
- `X-Markaestro-Signature`

Webhook secrets are shown once at creation time and stored hashed at rest.
