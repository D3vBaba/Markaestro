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
- Growth: drift alerts, campaigns, platform comparisons, opportunities.
- Advanced: experiments and Ask Markaestro (approved analytical tools only).

Deterministic services calculate scores, statistics, drift, and winners. Gemini
classifies content and explains supplied evidence. Missing metrics stay null.

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
