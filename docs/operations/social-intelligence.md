# Social intelligence operations

Social intelligence is additive to publishing. Firestore remains authoritative;
legacy post analytics stay readable while poll results dual-write canonical
`socialPosts` records and immutable metric snapshots. A one-time, idempotent
backfill also projects already-published `posts` (and their stored
`metricsByChannel`) into `socialPosts`, because the poller only dual-writes
on a live metrics fetch. The analytics tick pages this backfill under
`analytics/meta.socialPostsBackfillAt` after Foundation is enabled. Run
`npx tsx scripts/backfill-legacy-social-posts.ts <workspaceId>` to finish a
workspace immediately.

## Phase behavior

- Foundation: capability registry, canonical posts, audience profile, Audience Fit.
- Learning: tracked links/conversions, alignment, account-specific timing, playbook learnings.
- Growth: platform comparisons, opportunities (shown as next moves on the Playbook tab). Drift alerts and campaigns are computed but not surfaced in the app.
- Advanced: experiments (Experiments tab) and Ask Markaestro (Overview tab, approved analytical tools only).

The page shows five tabs: Overview (briefing, Ask Markaestro, figures, readiness), Content, Playbook (next moves and patterns), Audience (profile and tracked links), Experiments. Audience alignment is not shown until a connected platform reports demographics.

Deterministic services calculate scores, statistics, drift, and winners. Gemini
classifies content and explains supplied evidence. Missing metrics stay null.

## Read path, cache, and cost bounds

- `products/{productId}/intelligence/insights` caches the full
  `buildProductInsights` output (rollup, readiness, timing, learnings,
  opportunities, alignment, drift) for `INSIGHTS_CACHE_TTL_MS` (one hour) and
  is versioned by `INSIGHTS_CACHE_VERSION`. The overview, timing, decision,
  draft, and explain endpoints read it with `allowCached: true`, so a page load
  costs the cache document plus the two decision collections instead of the
  whole post history and the bootstrap statistics. `?fresh=1` (the Refresh
  button) and the hourly worker recompute write through the cache. Bump the
  version whenever the insights shape changes.
- `/api/intelligence/timing` serves the composer's Audience Fit panel from the
  cache; the composer never re-reads posts.
- Decision statuses are never stored in the cache; they are re-applied from
  `brandLearnings` and `optimizationRecommendations` on every read, and
  `decision: "proposed"` undoes an earlier decision.

### Published-post fingerprints (content patterns)

`src/lib/intelligence/published-post-fingerprints.ts` runs inside the
analytics tick whenever the Learning phase is enabled (shadow included). It
queues caption-only `content_fingerprint` jobs for `socialPosts` without a
`fingerprint`, stamps `fingerprint` / `fingerprintId` / `fingerprintedAt` on
the post when the job completes, and unlocks pillar, hook, and format
learnings plus the strategist's pillar and hook tools. Bounds: last 90 days
first, then older posts, then an hourly look at the newest 100 posts;
`FINGERPRINT_ENQUEUE_PER_TICK` (20) and `FINGERPRINT_DAILY_CAP` (500) per
workspace; media is never copied or sent. These jobs are system-owned
(`system: true`) and are not charged to the workspace AI quota. Cursors and
daily counters live on `analytics/meta` (`fingerprint*` fields).

### Generated drafts and explanations

- `POST /api/intelligence/drafts` ("Draft this") builds a brief from the
  brand's own measured evidence, audience profile, and brand voice, generates a
  caption with the fast model, and saves a normal Draft post in `posts` with an
  `intelligence` block (source, rationale, evidence ids, artifact id). It
  consumes one AI operation and one post-quota unit; it never schedules.
- `POST /api/intelligence/posts/{id}/explain` ("Why it worked") generates a
  short explanation once per post, cached on the post as `whyItWorked`; an AI
  operation is charged only on a cache miss (re-generated when the fingerprint
  or `EXPLANATION_VERSION` changes).
- Generated copy is sanitized (no em or en dashes) and every surface labels it
  as Generated.

### Tracked links

Click counters live on the tracked-link documents (`clicks`, `lastClickedAt`,
`attributedConversions`, `lastConversionAt`), incremented from the redirect
route and from conversion ingestion. Listing links therefore never scans
`conversionClicks`.

## Rollout

The global fallback is `SOCIAL_INTELLIGENCE_DEFAULT_STAGE=off`. Runtime config
is stored at `_rollouts/socialIntelligence`:

```json
{
  "killSwitch": false,
  "phases": {
    "foundation": {
      "stage": "allowlist",
      "workspaceAllowlist": ["workspace-id"],
      "userAllowlist": []
    },
    "learning": { "stage": "off" },
    "growth": { "stage": "off" },
    "advanced": { "stage": "off" }
  }
}
```

Allowed stages are `off`, `shadow`, `allowlist`, `percentage`, and
`entitled_ga`. All application APIs enforce the stage and plan entitlement on
the server. Set the global or phase `killSwitch` to stop reads, writes, imports,
and AI requests immediately. Shadow mode permits only system ingestion.

## Collections and retention

- `products/{productId}/intelligence/profile`: brand audience boundary.
- `socialPosts` and `socialPosts/{id}/metrics`: canonical post projection and
  immutable snapshots.
- `nativeImportCursors`: resumable 90-day platform discovery cursors.
- `contentFingerprints`, `intelligenceJobs`, `aiUsageDaily`: validated analysis,
  leased work, and quota accounting.
- `rawPlatformMetrics`: private GCS pointers and checksums, TTL 90 days.
- `aiArtifacts`: validated response audit artifacts, TTL 30 days.
- `campaigns`, `brandLearnings`, `optimizationRecommendations`,
  `audienceDriftEvents`, `experiments`, `trackedLinks`, and `conversionEvents`:
  workspace-scoped intelligence records.

Apply `firestore.indexes.json`, the policies in `firestore-ttl.md`, and a GCS
lifecycle rule deleting
`workspaces/*/private-intelligence/raw-platform-metrics/**` after 90 days.
Fingerprints remain until their source is deleted or a newer analysis version
replaces them. Normalized history is constrained at query time by plan.

## Vertex AI boundary

The App Hosting service account needs Vertex AI User access and private GCS
object access. Configure `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION`,
`VERTEX_AI_FAST_MODEL`, and `VERTEX_AI_STRATEGIST_MODEL`. Models receive GCS
URIs and delimited untrusted content, never OAuth tokens or database access.
Every response is schema-validated, repaired once, then safely failed.
Deterministic services—not Gemini—calculate scores, statistics, drift, and
experiment winners.

## Connections and approvals

`PLATFORM_CAPABILITY_REGISTRY` is the source of truth for versions, scopes,
approval state, metric availability, thresholds, and official documentation.
Enable `META_READ_USER_CONTENT_ENABLED` and
`LINKEDIN_MEMBER_ANALYTICS_ENABLED` only after platform approval, then require
affected accounts to reconnect. A global quarterly worker record appears in
`_platformCapabilityAudits`; operations must verify the linked official docs,
fill any sunset dates, complete required app review, and resolve alerts before
advancing rollout.

## Conversion ingestion

Create `CONVERSION_INGEST_SECRET` in Secret Manager. Server events send the raw
JSON body with `x-markaestro-signature: sha256=<hex HMAC-SHA256>`. Every event
requires a caller-supplied idempotency id and consent state. Redirects append
only the opaque `mkcid`; no raw IP, user-agent, token, content, or secret is
stored or logged. First- and last-click attribution use a 30-day window and
report whether an event was attributable.

## Release gates

Before advancing any phase: run lint, typecheck, live query validation, unit and
integration tests, the production build, migration dry run, IDOR tests,
publishing regression smoke tests, responsive/accessibility QA, and
`node scripts/check-i18n.mjs`. Observe structured events prefixed
`intelligence.*` and `platform.capability_*`; logs contain identifiers, counts,
latency, and error codes only.
