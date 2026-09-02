# API changelog

Every change to `/api/public/v1` and `/api/connect/v1`, dated. Integrators
should not have to discover a change by breaking.

The rules that govern what may appear here are in `src/lib/public-api/version.ts`
and are rendered into the OpenAPI description. In short: additions ship in
place, behaviour changes need a dated version, and removals need a new path
version with at least six months of `Sunset` notice.

Anything touching `src/app/api/public` or `src/app/api/connect` belongs in this
file in the same change, not afterwards.

---

## 2026-09-02

### Additions

**MCP server and agent skill.** `@markaestro/mcp` (in `mcp/`) exposes the
public API to AI agents as MCP tools: brand and destination discovery, draft
and scheduled post creation, publish with job-run polling, delete and bulk
operations, direct media upload, webhook registration, and a channel-rules
resource. Mutations carry an `Idempotency-Key` and retry on `Retry-After`.
The `markaestro` skill (`skills/markaestro/SKILL.md`) documents the posting
model for agents. No API behaviour changed.

---

## 2026-08-29

### Behaviour change

**`POST /api/public/v1/posts` now honours `scheduledAt`.**

It always accepted the field, validated it, and then discarded it: the post was
created as a draft and the response echoed `scheduledAt: null`, with no
warning. A client that sent a schedule got a silent no-op.

It now creates a scheduled post, writes `originalScheduledAt`, and wakes the
worker, matching what the Connect surface has always done.

This is a real change for anyone who built around the old behaviour. If you
were sending `scheduledAt` and relying on getting a draft back, either stop
sending it or publish explicitly.

Two consequences worth knowing before you send one:

- Scheduling runs the same preflight the composer does. A channel whose
  connection is expired or revoked is now rejected at create time with
  `VALIDATION_ERROR` and a per-channel `issues` array, instead of failing
  silently at publish time when the window has already passed.
- Scheduling a Facebook, Instagram, or TikTok post requires an explicit
  `deliveryMode`. Those channels default to `manual_reminder` on this surface,
  and a scheduled manual reminder is coherent but is probably not what you
  meant. Send `direct_publish` to publish at the scheduled time, or
  `manual_reminder` to be reminded to post it yourself.

### Additions

- **Multi-channel posts.** `POST /api/public/v1/posts` accepts
  `targets: [{ channel, destinationId?, deliveryMode?, settings? }]` alongside
  the existing single-`channel` shorthand. One post document, fanned out by the
  publisher, rather than the Connect layer's workaround of creating a separate
  post per destination and returning only the first id. `channel` and `targets`
  are mutually exclusive, and a channel may appear at most once in `targets`.
- **Per-target validation.** A multi-target request reports every failing
  target at once, as `VALIDATION_ERROR` with
  `details.issues: [{ channel, code, message }]`. Single-target requests keep
  their original single-code error, so existing clients are unaffected.
- **`publishedAt` on post responses.** When a post actually went live, as
  distinct from when it was due.
- **`targets[]` on post responses.** Present on every post, including ones
  created before multi-target existed and ones created in the app.
- **`GET /api/public/v1/job-runs`.** Cursor-paginated, filterable by `status`
  and `resourceId`. Previously a run could only be fetched by id, so a client
  that lost an id could not recover it.
- **`GET /api/public/v1/media`.** Cursor-paginated, filterable by `type`.
  Includes assets uploaded in the app, not only through the API.
- **`POST /api/public/v1/posts/bulk`.** Reschedule, delete, or change status on
  up to 25 posts in one call. Partial success is the contract:
  `{ succeeded[], failed[{ id, error }] }`, and 400 only when nothing
  succeeded.
- **`GET /api/connect/v1/media` returns real data.** It used to authenticate,
  spend rate-limit budget, increment the client's request counter, and return a
  hardcoded empty array while being documented as a real endpoint.
- **`Idempotency-Key` on `POST /api/connect/v1/posts`.** This is the route
  third-party scheduling clients call and the one that fans out across up to
  four destinations, so a retried request used to create duplicates on every
  one of them. A replay now returns the identical body, partial-failure list
  included.
- **`Markaestro-Version` on every response.** Names the dated version the
  request ran under. Send it as a request header to pin a specific version.
- **`GET /api/public/v1/openapi.json`.** The machine-readable description of
  this API, generated from the schemas the routes validate against.

### Relaxed limits

- **Caption length.** The schema capped captions at 4,000 characters before
  per-channel validation ran, which made the API roughly fifteen times stricter
  than the composer for Facebook. The bound is now the widest channel limit
  (63,206); per-channel rules are unchanged and still apply.
- **Media count.** The schema's fixed 35 is now derived from the channel
  catalog's maximum, for the same reason.

### Errors

- Every error code the API can return is now enumerated, with its status,
  whether an identical retry can succeed, and what it means. The list is in the
  OpenAPI description under **Errors**.
- New codes: `VALIDATION_CHANNEL_REQUIRED`, `VALIDATION_INVALID_SCHEDULED_AT`,
  `VALIDATION_SCHEDULED_DELIVERY_MODE_REQUIRED`,
  `VALIDATION_MULTIPLE_TARGET_SETTINGS_UNSUPPORTED`,
  `VALIDATION_UNKNOWN_API_VERSION`.
- Errors carry `userMessage` where the application authored the sentence. It is
  safe to show a person verbatim. Keep branching on `error`, which is the
  machine code and does not get reworded.

### Hardening (same date, later change set)

- **`Idempotency-Key` is now honoured on every mutating route** on both
  surfaces: webhook endpoint create, media upload sessions, and both public
  DELETEs joined the create/publish routes. Reusing a key with a different
  body is refused; a replay returns the original response verbatim.
- **Webhook retries** back off over ~a day (1m, 5m, 25m, 2h, 6h, 24h, with
  jitter) instead of one hour. Exhausted deliveries land in a `dead_letter`
  status, replayable for 7 days from settings; an endpoint failing 10
  consecutive attempts is deferred to one slow probe until it recovers.
  `dead_letter` appears in delivery listings where `failed` used to be the
  terminal state; `failed` still occurs when the endpoint itself is gone.
- **In-app publishing is rate limited** (10/min per workspace, 30/hour per
  channel), answering `RATE_LIMITED_CHANNEL` with `retryAfterSeconds` when a
  channel's hourly ceiling is hit.
- **Post quota is metered on API creates**, matching the app path. No paid
  tier currently caps posts, so nothing changes today; the counters stop
  under-reporting.
- **Media asset responses** gained `processingState` and `thumbnailUrl`: a
  worker now derives a 320px thumbnail per image shortly after upload.

### Known limitation

A post stores one platform `settings` object, so a multi-target request may
carry `settings` on at most one target. More than one is refused with
`VALIDATION_MULTIPLE_TARGET_SETTINGS_UNSUPPORTED` rather than silently keeping
the first, because publishing a post whose TikTok privacy or Instagram
collaborators were quietly dropped is the worse failure. Create one post per
channel that needs its own settings.

---

## 2026-01-01

The original v1 behaviour. Everything before dated versioning existed is pinned
here.
