# ReelFarm-Style TikTok Slideshows in Markaestro Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a production-grade ReelFarm-style slideshow generation workflow to Markaestro that creates high-performing TikTok slideshow/carousel assets from structured slide briefs, upgrades the image generation pipeline to slide-aware output quality, and publishes through Markaestro’s existing TikTok review/export flow.

**Architecture:** Build a new slideshow domain on top of the existing Next.js + Firebase + AI stack rather than bolting more logic into plain posts. Slideshows become first-class workspace resources with their own generation jobs, slide metadata, quality/consistency fields, and post export path. The first production release targets image-based TikTok slideshows/carousels; the domain model is deliberately shaped so a future MP4 renderer can attach without reworking storage, generation, or publish APIs.

**Tech Stack:** Next.js App Router, TypeScript, Firebase/Firestore, Vitest, OpenAI, Google Generative AI, Sharp, existing Markaestro TikTok publishing adapter.

---

## Scope and acceptance criteria

### In scope for this release
- First-class slideshow resource with slide-level metadata
- AI slideshow generation endpoint
- Slide-specific image generation pipeline tuned for TikTok slideshow composition
- Slideshow draft editor in Markaestro UI
- Export slideshow to Markaestro post object for TikTok publishing/scheduling
- Public/internal API support for slideshow-backed TikTok carousel posts
- Tests for schemas, generation orchestration, export behavior, and validations
- Operational safeguards: idempotency, status tracking, failure states, retry-safe writes, structured metadata

### Explicitly out of scope for this release
- MP4 rendered slideshow videos
- Browser automation posting
- Non-TikTok slideshow channels in v1
- Template designer UI for arbitrary visual layouts

### Production acceptance criteria
- A workspace user can generate a slideshow from a product + prompt + style constraints
- The system creates 6–10 ordered slides with distinct hooks and visual prompts
- Every slide stores text, image prompt, image URL, style metadata, and quality notes
- A slideshow can be edited and regenerated per-slide without regenerating the whole slideshow
- A slideshow can be exported into a single TikTok post with multiple media URLs
- Publishing uses the existing TikTok review/export flow with no regressions to standard posts
- Existing public/internal publish flows remain backward compatible
- All new schemas and helpers have Vitest coverage

---

## Design decisions

### Decision 1: Add a first-class `slideshows` collection
Do not overload `posts` with slide authoring state. A slideshow is a generated content asset; a post is a publishable channel artifact. Export from slideshow -> post when ready.

### Decision 2: Keep `posts` as the canonical publish entity
Publishing, scheduling, retry, rate limiting, analytics, webhook delivery, and channel adapter behavior already center on `posts`. Reuse that path.

### Decision 3: Upgrade image generation by introducing slide intent + composition constraints
Current image generation is excellent for single social images, but ReelFarm-like output needs stronger control over:
- hook-safe text regions
- sequence-level visual diversity
- inter-slide consistency
- TikTok-native 9:16 composition rules
- overlay-friendly backgrounds

### Decision 4: Use status-driven orchestration
Mirror existing generation flow:
- researching
- generating_slides
- generating_images
- ready
- failed
- exported

### Decision 5: Leave future video support as an extension point
Add `renderMode`, `renderStatus`, and reserved output fields now so MP4 support can be added later without a data migration panic.

---

## Files to create or modify

### New domain files
- Create: `src/lib/slideshows/types.ts`
- Create: `src/lib/slideshows/schemas.ts`
- Create: `src/lib/slideshows/generator.ts`
- Create: `src/lib/slideshows/export.ts`
- Create: `src/lib/slideshows/quality.ts`
- Create: `src/lib/slideshows/firestore.ts`
- Create: `src/lib/__tests__/slideshows-schemas.test.ts`
- Create: `src/lib/__tests__/slideshows-export.test.ts`
- Create: `src/lib/__tests__/slideshows-quality.test.ts`

### New API routes
- Create: `src/app/api/slideshows/route.ts`
- Create: `src/app/api/slideshows/[id]/route.ts`
- Create: `src/app/api/slideshows/[id]/generate/route.ts`
- Create: `src/app/api/slideshows/[id]/export/route.ts`
- Create: `src/app/api/slideshows/[id]/slides/[slideId]/regenerate-image/route.ts`

### New UI files
- Create: `src/app/slideshows/page.tsx`
- Create: `src/app/slideshows/[id]/page.tsx`
- Create: `src/app/slideshows/_components/SlideshowCreateSheet.tsx`
- Create: `src/app/slideshows/_components/SlideCard.tsx`
- Create: `src/app/slideshows/_components/SlideListEditor.tsx`
- Create: `src/app/slideshows/_components/SlideshowStatusBadge.tsx`

### Existing files to modify
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/ai/image-generator.ts`
- Modify: `src/lib/ai/content-generator.ts` (only if common prompt builders need extraction)
- Modify: `src/lib/public-api/schemas.ts`
- Modify: `src/lib/public-api/posts.ts`
- Modify: `src/app/developers/api/page.tsx`
- Modify: `src/app/content/_components/CreateTab.tsx`
- Modify: `src/app/content/page.tsx` (link to slideshow workflow if desired)
- Modify: `src/app/api/posts/[id]/publish/route.ts` only if slideshow-export metadata needs richer response
- Modify: `src/lib/social/publisher.ts` only if exported slideshow metadata should be preserved in publish results
- Modify: `README.md` or `docs/PUBLIC_API.md`

---

## Data model

### Slideshow document (`workspaces/{workspaceId}/slideshows/{slideshowId}`)

```ts
{
  id: string;
  workspaceId: string;
  productId: string;
  title: string;
  prompt: string;
  channel: 'tiktok';
  status: 'draft' | 'researching' | 'generating_slides' | 'generating_images' | 'ready' | 'failed' | 'exported';
  renderMode: 'carousel_images';
  renderStatus: 'not_started' | 'ready';
  aspectRatio: '9:16';
  slideCount: number;
  caption: string;
  coverSlideIndex: number;
  visualStyle: string;
  imageProvider: string;
  imageStyle: string;
  generationVersion: number;
  exportPostId: string | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### Slide item embedded under slideshow
Use a `slides` subcollection for easier per-slide regeneration and update isolation.

Path:
`workspaces/{workspaceId}/slideshows/{slideshowId}/slides/{slideId}`

```ts
{
  id: string;
  index: number;
  kind: 'hook' | 'body' | 'cta';
  headline: string;
  body: string;
  cta: string;
  imagePrompt: string;
  imageUrl: string;
  imageStatus: 'pending' | 'generated' | 'failed';
  visualIntent: {
    composition: string;
    subjectFocus: string;
    safeTextRegion: 'top' | 'middle' | 'bottom';
    lighting: string;
    colorMood: string;
    motionStyle: string;
  };
  quality: {
    hookStrength: number;
    readability: number;
    distinctiveness: number;
    visualClarity: number;
    notes: string[];
  };
  createdAt: string;
  updatedAt: string;
}
```

### Exported post metadata
Extend post docs with optional slideshow metadata:

```ts
{
  sourceType?: 'manual' | 'pipeline' | 'slideshow';
  slideshowId?: string;
  slideshowTitle?: string;
  slideshowSlideCount?: number;
  slideshowCoverIndex?: number;
}
```

---

## Task 1: Add slideshow enums and base schemas

**Objective:** Introduce strongly typed slideshow concepts at the shared schema layer.

**Files:**
- Modify: `src/lib/schemas.ts`
- Test: `src/lib/__tests__/slideshows-schemas.test.ts`

**Step 1: Add enums and zod schemas**
Add:
- `slideshowChannels = ['tiktok']`
- `slideshowStatuses = ['draft','researching','generating_slides','generating_images','ready','failed','exported']`
- `slideshowRenderModes = ['carousel_images']`
- `slideKinds = ['hook','body','cta']`
- `slideImageStatuses = ['pending','generated','failed']`
- `safeTextRegions = ['top','middle','bottom']`

Create reusable schemas for:
- slideshow create input
- slideshow update input
- slide item
- visual intent
- quality block

**Step 2: Write failing tests**
Create `src/lib/__tests__/slideshows-schemas.test.ts` with cases for:
- valid 6-slide slideshow input
- invalid non-TikTok channel
- invalid slideCount outside 3–10
- invalid safe text region

**Step 3: Run tests**
Run:
`npm test -- src/lib/__tests__/slideshows-schemas.test.ts`

Expected: failing before implementation, passing after.

**Step 4: Commit**
`git commit -m "feat: add slideshow shared schemas"`

---

## Task 2: Add slideshow domain helpers

**Objective:** Centralize slideshow document serialization, status helpers, and Firestore path helpers.

**Files:**
- Create: `src/lib/slideshows/types.ts`
- Create: `src/lib/slideshows/firestore.ts`
- Test: `src/lib/__tests__/slideshows-schemas.test.ts`

**Step 1: Create shared types**
Define TS interfaces that mirror the zod schemas.

**Step 2: Create Firestore helpers**
Add helpers:
- `workspaceSlideshowsCollection(workspaceId)`
- `slideshowDoc(workspaceId, slideshowId)`
- `slideshowSlidesCollection(workspaceId, slideshowId)`
- `serializeSlideshowDoc()`
- `serializeSlideDoc()`

**Step 3: Add lightweight tests**
Verify path helpers and serializer defaults.

**Step 4: Commit**
`git commit -m "feat: add slideshow domain helpers"`

---

## Task 3: Add slideshow quality scoring helpers

**Objective:** Create deterministic scoring helpers so generated slides can be ranked and flagged before export.

**Files:**
- Create: `src/lib/slideshows/quality.ts`
- Test: `src/lib/__tests__/slideshows-quality.test.ts`

**Step 1: Add helper functions**
Implement:
- `scoreHookStrength(text)`
- `scoreReadability(text)`
- `scoreDistinctiveness(currentSlide, previousSlides)`
- `buildSlideQuality(slide, context)`

Use rule-based heuristics first; avoid over-engineering.

**Step 2: Test heuristics**
Add tests proving:
- short hook beats long rambling hook
- duplicated slide themes reduce distinctiveness
- missing headline/body lowers readability

**Step 3: Commit**
`git commit -m "feat: add slideshow quality scoring"`

---

## Task 4: Build a dedicated slideshow generator

**Objective:** Generate slide-first structured outputs instead of repurposing generic post generation.

**Files:**
- Create: `src/lib/slideshows/generator.ts`
- Modify: `src/lib/ai/content-generator.ts` only if shared prompt builders should be extracted
- Test: `src/lib/__tests__/slideshows-schemas.test.ts` or a new `slideshows-generator.test.ts`

**Step 1: Create slideshow prompt builder**
Prompt requirements:
- 6–10 slides
- slide 1 = strong hook
- middle slides = one insight per slide
- final slide = CTA
- each slide must include:
  - headline
  - optional body
  - imagePrompt seed
  - visual intent block

**Step 2: Require strict JSON output**
Return:
```json
{
  "title": "...",
  "caption": "...",
  "slides": [ ... ]
}
```

**Step 3: Add retry + validation**
If model output fails schema parse:
- retry once with repair prompt
- if still invalid, fail with structured error

**Step 4: Add tests**
Mock LLM output; test schema normalization and fallback behavior.

**Step 5: Commit**
`git commit -m "feat: add structured slideshow generator"`

---

## Task 5: Upgrade image generation for slideshow mode

**Objective:** Add slide-aware, ReelFarm-like image generation constraints without breaking existing single-post image generation.

**Files:**
- Modify: `src/lib/ai/image-generator.ts`
- Create: `src/lib/slideshows/image-prompting.ts` (optional but recommended)
- Test: `src/lib/__tests__/slideshows-quality.test.ts` or new `slideshows-image-prompting.test.ts`

**Step 1: Extend ImageGenRequest**
Add optional slideshow fields:
- `generationMode?: 'single_post' | 'slideshow_slide'`
- `slideContext?: { index; totalSlides; kind; previousVisualSignatures; safeTextRegion; visualIntent }`

**Step 2: Add slideshow prompt path**
When `generationMode === 'slideshow_slide'`, enforce:
- 9:16 composition
- strong empty/safe text region
- reduced central clutter
- TikTok-native high contrast readability
- sequence diversity across slides
- consistent brand/world feel across the slideshow

**Step 3: Add visual signature tracking**
Return or compute a normalized visual signature for each generated slide so subsequent prompts avoid repetition.

**Step 4: Add tests**
Verify slideshow prompt assembly contains:
- safe text region instruction
- anti-duplication instructions
- 9:16 instruction
- slide-specific role (hook/body/cta)

**Step 5: Commit**
`git commit -m "feat: add slideshow-aware image prompting"`

---

## Task 6: Add slideshow CRUD API

**Objective:** Create and fetch slideshow resources from the app.

**Files:**
- Create: `src/app/api/slideshows/route.ts`
- Create: `src/app/api/slideshows/[id]/route.ts`
- Create: `src/lib/slideshows/export.ts`
- Test: add route-level tests only if route testing is already established; otherwise test helpers directly

**Step 1: POST /api/slideshows**
Create draft slideshow with:
- productId
- prompt
- slideCount
- imageStyle
- imageProvider
- visualStyle

**Step 2: GET /api/slideshows**
List workspace slideshows with pagination-ready ordering.

**Step 3: GET /api/slideshows/[id]**
Return slideshow + ordered slides.

**Step 4: PATCH /api/slideshows/[id]**
Allow title/caption/manual slide text updates.

**Step 5: Commit**
`git commit -m "feat: add slideshow CRUD API"`

---

## Task 7: Add slideshow generation route

**Objective:** Orchestrate research, slide generation, image generation, and slide writes in one server flow.

**Files:**
- Create: `src/app/api/slideshows/[id]/generate/route.ts`
- Modify: `src/lib/slideshows/generator.ts`
- Modify: `src/lib/ai/image-generator.ts`

**Step 1: Load slideshow + product context**
Require authenticated workspace context and `campaigns.write`-equivalent permission.

**Step 2: Mark statuses in order**
Update slideshow doc status:
- `researching`
- `generating_slides`
- `generating_images`
- `ready`

**Step 3: Generate structured slides**
Use product + prompt + brand voice + optional market research.

**Step 4: Generate images concurrently with caps**
Use low concurrency (2–3) and write per-slide updates safely.

**Step 5: Persist slide quality metrics**
Score each slide after generation.

**Step 6: Failure handling**
Any unhandled error must:
- mark slideshow `failed`
- retain partial slide data if present
- write `errorMessage`

**Step 7: Commit**
`git commit -m "feat: add slideshow generation orchestration"`

---

## Task 8: Add per-slide image regeneration

**Objective:** Let users regenerate only one weak slide image without regenerating the slideshow.

**Files:**
- Create: `src/app/api/slideshows/[id]/slides/[slideId]/regenerate-image/route.ts`
- Modify: `src/lib/ai/image-generator.ts`
- Test: helper tests for prompt rebuilding and slide update behavior

**Step 1: Load slideshow + slide + neighboring slide context**
Pass prior slide visual signatures into image regeneration.

**Step 2: Regenerate image only**
Preserve text, update image fields and quality metrics.

**Step 3: Commit**
`git commit -m "feat: add per-slide image regeneration"`

---

## Task 9: Export slideshow to a post

**Objective:** Convert a ready slideshow into a standard Markaestro post that publishes using the existing TikTok flow.

**Files:**
- Create: `src/app/api/slideshows/[id]/export/route.ts`
- Create: `src/lib/slideshows/export.ts`
- Test: `src/lib/__tests__/slideshows-export.test.ts`

**Step 1: Create export helper**
`exportSlideshowToPost(workspaceId, slideshow, slides)` should create/update a post doc with:
- `channel: 'tiktok'`
- `content: slideshow.caption`
- `mediaUrls: ordered slide image URLs`
- `sourceType: 'slideshow'`
- `slideshowId`
- `slideshowTitle`
- `slideshowSlideCount`
- `status: 'draft'` or `scheduled`

**Step 2: Write tests**
Verify exported post order and metadata.

**Step 3: Mark slideshow exported**
Store `exportPostId` on slideshow.

**Step 4: Commit**
`git commit -m "feat: export slideshows into posts"`

---

## Task 10: Extend post/public API schemas for slideshow metadata

**Objective:** Preserve slideshow-origin metadata across serialization while remaining backward compatible.

**Files:**
- Modify: `src/lib/public-api/posts.ts`
- Modify: `src/lib/public-api/schemas.ts`
- Modify: `src/lib/__tests__/public-api-posts.test.ts`
- Modify: `docs/PUBLIC_API.md`

**Step 1: Add optional serialized fields**
Expose optional post metadata:
- `sourceType`
- `slideshowId`
- `slideshowTitle`
- `slideshowSlideCount`

**Step 2: Add tests**
Ensure old consumers still pass and new fields serialize when present.

**Step 3: Commit**
`git commit -m "feat: expose slideshow metadata in post APIs"`

---

## Task 11: Build slideshow UI list page

**Objective:** Give Markaestro a first-class place to manage slideshow assets.

**Files:**
- Create: `src/app/slideshows/page.tsx`
- Create: `src/app/slideshows/_components/SlideshowCreateSheet.tsx`
- Create: `src/app/slideshows/_components/SlideshowStatusBadge.tsx`

**Step 1: List slideshows**
Display title, product, slide count, status, updatedAt.

**Step 2: Create draft slideshow**
Form fields:
- product
- prompt
- slideCount
- visual style
- image style
- provider

**Step 3: Trigger generation**
After create, navigate to detail page and start generation.

**Step 4: Commit**
`git commit -m "feat: add slideshow management page"`

---

## Task 12: Build slideshow detail editor

**Objective:** Let users inspect, edit, regenerate, and export a slideshow.

**Files:**
- Create: `src/app/slideshows/[id]/page.tsx`
- Create: `src/app/slideshows/_components/SlideCard.tsx`
- Create: `src/app/slideshows/_components/SlideListEditor.tsx`

**Step 1: Show slideshow header**
Display status, caption, export state, regenerate button.

**Step 2: Show ordered slide cards**
Each card includes:
- index and kind
- image preview
- headline/body fields
- quality warnings
- regenerate image button

**Step 3: Export to post**
Button should call `/api/slideshows/[id]/export`.

**Step 4: Deep-link to content/publish flow**
After export, open the linked post or content screen.

**Step 5: Commit**
`git commit -m "feat: add slideshow detail editor"`

---

## Task 13: Integrate slideshow workflow into existing content UI

**Objective:** Make slideshow creation feel native to Markaestro, not a sidecar tool.

**Files:**
- Modify: `src/app/content/page.tsx`
- Modify: `src/app/content/_components/CreateTab.tsx`
- Optional: add nav links in app shell

**Step 1: Add entry point**
From Content, add CTA: “Create TikTok Slideshow”.

**Step 2: Preserve existing post composer**
Do not merge slideshow authoring into CreateTab immediately. Link out to dedicated slideshow flow to keep complexity manageable.

**Step 3: Commit**
`git commit -m "feat: connect slideshow workflow to content UI"`

---

## Task 14: Verify TikTok publish/export compatibility

**Objective:** Ensure slideshow-exported posts flow through the existing TikTok adapter with no schema mismatches.

**Files:**
- Modify: `src/lib/platform/adapters/tiktok-publishing.ts` only if needed
- Modify: `src/app/api/posts/[id]/publish/route.ts` only if slideshow metadata should be echoed
- Test: unit tests around export helper and existing publish validations

**Step 1: Validate exported post shape**
Ensure:
- multiple `mediaUrls` preserve order
- captions stay under TikTok title/description constraints
- deliveryMode remains `user_review`

**Step 2: Add any missing validation**
If slideshow export can exceed safe limits, reject at export time.

**Step 3: Commit**
`git commit -m "fix: harden slideshow export for TikTok publishing"`

---

## Task 15: Documentation and rollout checklist

**Objective:** Document the feature so it can be operated in production.

**Files:**
- Modify: `README.md`
- Modify: `docs/PUBLIC_API.md`
- Optional: `docs/slideshows.md`

**Step 1: Add operator docs**
Document:
- required env vars
- supported providers
- TikTok export behavior
- failure states
- per-slide regeneration

**Step 2: Add rollout checklist**
Include:
- Firestore index review
- API key and provider checks
- quota monitoring
- Sentry alerting for slideshow generation failures

**Step 3: Commit**
`git commit -m "docs: add slideshow feature documentation"`

---

## Testing strategy

### Unit tests
Run targeted tests during development:
- `npm test -- src/lib/__tests__/slideshows-schemas.test.ts`
- `npm test -- src/lib/__tests__/slideshows-quality.test.ts`
- `npm test -- src/lib/__tests__/slideshows-export.test.ts`
- `npm test -- src/lib/__tests__/public-api-posts.test.ts`

### Full suite before merge
- `npm test`
- `npm run lint`
- `npm run build`

### Manual verification checklist
1. Create slideshow draft from product
2. Generate 6-slide slideshow
3. Confirm each slide has unique image and quality metadata
4. Regenerate one slide image
5. Export slideshow to post
6. Publish exported post to TikTok review flow
7. Schedule exported post and run scheduled publisher
8. Confirm old standard posts still publish

---

## Risks and mitigations

### Risk: image generation quality is inconsistent across slides
Mitigation:
- store slide visual signatures
- score distinctiveness
- add per-slide regeneration
- reserve safe text regions explicitly

### Risk: exported TikTok slides exceed platform limits
Mitigation:
- hard cap slideshow slide count at 10 for v1
- validate caption length at export
- validate all slides have generated images before export

### Risk: Firestore write amplification during generation
Mitigation:
- batch initial slide writes
- keep image concurrency low
- update only changed slide docs on regeneration

### Risk: mixing slideshow authoring into generic post composer creates UI debt
Mitigation:
- dedicated slideshow screens
- export into canonical post only at the end

---

## Recommended implementation order
1. Tasks 1–3: schema + domain + quality helpers
2. Tasks 4–5: generator + image pipeline upgrade
3. Tasks 6–9: CRUD + generation + export APIs
4. Tasks 11–13: UI
5. Tasks 10 + 14 + 15: compatibility, docs, hardening

---

## First coding milestone
After Tasks 1–5 are complete, the codebase should be able to:
- produce a structured slideshow payload
- generate slide-aware images with ReelFarm-style composition constraints
- score slides for quality before any UI exists

That is the correct first milestone because it hardens the content engine before UI polish.

---

Plan complete and saved. Next step: begin implementing Tasks 1–3, then scaffold the slideshow API surface before touching UI.