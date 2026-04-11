# TikTok Slideshow Feature — Developer Guide

## Overview

Slideshows are a first-class workspace resource (separate from `posts`) that generate TikTok carousel
content from a product + prompt. The lifecycle ends with an _export_ step that converts the slideshow
into a standard `posts` document, which the existing TikTok publishing adapter then publishes.

---

## Architecture

```
Product + Prompt
       │
       ▼
POST /api/slideshows          ← create a draft slideshow doc
       │
       ▼
POST /api/slideshows/:id/generate
  Phase 1 — researching        (status update, load product)
  Phase 2 — generating_slides  (GPT-4o-mini → N slide briefs)
  Phase 3 — generating_images  (Gemini/DALL-E, concurrency=2, per-slide Firestore updates)
  Phase 4 — ready
       │
       ▼  (per-slide regeneration available at any time)
POST /api/slideshows/:id/slides/:slideId/regenerate-image
       │
       ▼
POST /api/slideshows/:id/export
  assertSlideshowExportable()   ← TikTok constraints, image checks
  buildExportedSlideshowPost()  ← CreatePost payload
  Firestore transaction:         post.set() + slideshow.update(status:'exported')
       │
       ▼
Standard posts publish pipeline (publisher.ts → tiktok-publishing adapter)
```

---

## Firestore Structure

```
workspaces/{workspaceId}/
  slideshows/{slideshowId}          ← SlideshowDoc
    slides/{slideId}                ← SlideDoc (subcollection, ordered by `index`)
  posts/{postId}                    ← Created on export; canonical publish entity
```

The slideshow and post are **independent documents**. The post records `sourceType: 'slideshow'`,
`slideshowId`, `slideshowTitle`, `slideshowSlideCount`, and `slideshowCoverIndex` for attribution.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/slideshows/types.ts` | `SlideshowDoc`, `SlideDoc`, domain type helpers |
| `src/lib/slideshows/firestore.ts` | Collection refs, `serializeSlideshowDoc`, `serializeSlideDoc` |
| `src/lib/slideshows/generator.ts` | GPT-4o-mini prompt, slide brief parsing, quality hydration |
| `src/lib/slideshows/quality.ts` | `buildVisualSignature`, `buildSlideQuality` scoring |
| `src/lib/slideshows/export.ts` | `assertSlideshowExportable`, `buildExportedSlideshowPost` |
| `src/lib/ai/image-generator.ts` | Extended with `SlideContext`; slideshow mode bypasses scene interpreter |
| `src/app/api/slideshows/route.ts` | `GET` (list) + `POST` (create) |
| `src/app/api/slideshows/[id]/route.ts` | `GET` (detail + slides) + `PATCH` (update fields/slides) |
| `src/app/api/slideshows/[id]/generate/route.ts` | Full generation orchestration (3-phase) |
| `src/app/api/slideshows/[id]/export/route.ts` | Export slideshow → post (Firestore transaction) |
| `src/app/api/slideshows/[id]/slides/[slideId]/regenerate-image/route.ts` | Per-slide image regeneration |
| `src/app/slideshows/` | List page + create sheet |
| `src/app/slideshows/[id]/` | Detail editor with slide grid |

---

## Status State Machine

```
draft
  └─► researching
        └─► generating_slides
              └─► generating_images
                    ├─► ready       ← images may be partially failed
                    └─► failed      ← whole generation failed
ready / exported
  └─► (re-generate puts it back through researching)
ready
  └─► exported    ← after POST /export; re-export is allowed
```

A slideshow becomes `ready` even if some individual slide images failed — failed slides carry
`imageStatus: 'failed'` and the user can regenerate them individually before exporting.

---

## Generation Pipeline

### Phase 1 — Slide content (GPT-4o-mini)

`generateSlideshowContent()` in `generator.ts` calls GPT-4o-mini with a structured JSON prompt.
Each slide brief includes:
- `kind`: `hook | body | cta`
- `headline`, `body`, `cta` — copy
- `imagePrompt` — scene description
- `visualIntent` — composition, subjectFocus, safeTextRegion, lighting, colorMood, motionStyle

On parse failure it retries once at temperature 0.2 with the raw output appended. If the retry also
fails, it throws `'SLIDESHOW_GENERATION_FAILED: ...'`.

### Phase 2 — Image generation

Images are generated in a drain-queue concurrency pool (`IMAGE_CONCURRENCY = 2`).

Each slide receives a `SlideContext` containing:
- Its position in the sequence (`index`, `totalSlides`)
- Its `kind` and `safeTextRegion`
- `previousVisualSignatures` — fingerprints of all preceding slides, used to enforce visual diversity

The image generator builds a slideshow-specific prompt via `buildSlideshowImagePrompt()` in
`image-generator.ts`. This bypasses the normal `interpretSceneIntent` LLM call because the
slideshow generator already produces a structured `visualIntent`.

Safe-text-region instructions per region:
- **top**: leave top 30% uncluttered, place visual weight in the lower two-thirds
- **middle**: keep vertical center clear, push visual mass to top/bottom thirds
- **bottom**: keep bottom 25% free of detail, anchor the composition at the top

### Visual signatures

`buildVisualSignature()` (in `quality.ts`) hashes a slide's headline + imagePrompt + visualIntent
into a short string. These signatures are computed once from generator output and passed as
`previousVisualSignatures` to each subsequent slide's image call — no extra Firestore reads.

---

## Export & TikTok Compatibility

`assertSlideshowExportable()` enforces:
- Channel must be `tiktok`
- Status must be `ready` or `exported`
- Slide count must be 3–10 (TikTok carousel minimum/practical maximum for v1)
- Caption length must not exceed 4000 characters (TikTok API hard limit)
- Every slide must have `imageStatus === 'generated'` **and** a non-empty `imageUrl`
  (checking `imageStatus` prevents exporting slides where regeneration failed but the old URL
  was retained)

`buildExportedSlideshowPost()` produces a `CreatePost` payload where:
- `mediaUrls` = slide image URLs sorted by `index` ascending
- `slideshowCoverIndex` maps to TikTok's `photo_cover_index` (0-based cover image position)

The publisher passes `slideshowCoverIndex` through as `photoCoverIndex` on `PublishRequest`, and
the TikTok adapter uses it as `photo_cover_index` in the PULL_FROM_URL body. TikTok requires
images to be served from a verified domain, so the adapter proxies Firebase Storage URLs through
`/api/media/proxy`.

---

## Permissions

| Action | Required permission |
|--------|-------------------|
| Create/generate/regenerate slideshow | `campaigns.write` + `ai.use` |
| Read slideshow | (workspace member) |
| Update slideshow fields | `campaigns.write` |
| Export slideshow → post | `posts.write` |

---

## API Quick Reference

```
POST   /api/slideshows                                  Create draft
GET    /api/slideshows?status=ready                     List (optional status filter)
GET    /api/slideshows/:id                              Detail + slides
PATCH  /api/slideshows/:id                              Update title/caption/coverSlideIndex/slides
POST   /api/slideshows/:id/generate                     Run full generation
POST   /api/slideshows/:id/export                       Export to post (returns postId)
POST   /api/slideshows/:id/slides/:slideId/regenerate-image   Regenerate one slide image
```

### Create slideshow body

```json
{
  "productId": "prod_abc",
  "prompt": "Show why our sleep supplement is better than melatonin",
  "slideCount": 6,
  "channel": "tiktok",
  "aspectRatio": "9:16",
  "renderMode": "carousel_images",
  "imageStyle": "branded",
  "imageProvider": "gemini"
}
```

### Export response

```json
{
  "postId": "post_xyz",
  "slideshowId": "ss_abc",
  "channel": "tiktok",
  "mediaUrls": ["https://...1.jpg", "...2.jpg", "...6.jpg"],
  "slideCount": 6
}
```

---

## Adding a New Channel

Slideshows are TikTok-only in v1. To add a channel:

1. Add the value to `slideshowChannels` in `src/lib/schemas.ts`
2. Update `assertSlideshowExportable()` in `export.ts` to allow the new channel
3. Adjust slide count limits if the new channel has different carousel constraints
4. Ensure the platform adapter handles the `photoCoverIndex` field if relevant

---

## Testing

```
src/lib/__tests__/slideshows-generator.test.ts   13 tests — parseRawSlideshowOutput, quality hydration
src/lib/__tests__/slideshows-export.test.ts      11 tests — export validation and payload shape
```

Run: `npm test`
