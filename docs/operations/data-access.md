# Data model and access matrix

The 4.13 audit of `firestore.rules` against the actual collection inventory.
Generated from a grep of every `adminDb.collection(...)` / `adminDb.doc(...)`
call in `src/`, then classified by hand. Re-run the sweep when adding a
collection:

```bash
grep -rhoE 'adminDb\s*\.\s*(collection|doc)\(`[^`]+`\)' src --include='*.ts'
```

## The security model, stated once

Every application read and write goes through a Next.js API route using the
Firebase **Admin SDK**, which bypasses security rules entirely. Authorization
therefore lives in the route layer: `requireContext` (session), scoped API
keys (`requirePublicApiContext`), worker shared secrets, and the RBAC helpers.
`firestore.rules` is a **backstop**, and it denies everything: the Web SDK is
initialized on the client for Authentication only, and no browser code reads
or writes Firestore directly. `firestore-client-isolation.test.ts` enforces
that premise in CI, because the deny-all rules are only sound while it holds.
`firestore-rules.emulator.test.ts` exercises the rules themselves against the
emulator (anonymous and signed-in denials on every path below); it runs
whenever `FIRESTORE_EMULATOR_HOST` is set and skips otherwise.

`storage.rules` follows the same posture.

## Collection inventory

### Workspace-scoped (under `workspaces/{ws}/...`)

Access is authorized per-request by workspace membership (session cookie or
workspace-bound API key). No path here is reachable from a browser.

| Collection | Written by | Notes |
| --- | --- | --- |
| `posts` (+ `publishAttempts` and `platformOperations` subcolls.) | app + public/connect API + worker | The core resource and durable provider-operation checkpoints. |
| `evergreenQueues` (+ `variants` and `runs` subcolls.), `evergreenAudit` | app + public API + worker | Evidence-backed recurring policies, immutable run lineage, and transition audit trail. |
| `providerUsage` | platform adapters | Monthly per-provider request and estimated-cost counters used by workspace budget gates. |
| `products` | app + API | Brands. |
| `members` | app, team routes | Also read via collection-group query at sign-in (bounded, limit 100). |
| `pendingInvites` | team routes | Read via collection-group query by invite email. |
| `job_runs` | publish paths + worker | Client-facing publish run records. |
| `webhook_endpoints`, `webhook_deliveries` | settings + public API + worker | Secrets stored encrypted + hashed. |
| `api_clients` | settings routes | Secret hashes only; plaintext returned once. |
| `media_assets`, `upload_sessions`, `connect_upload_sessions` | media routes | Reference-counted storage accounting. |
| `experiments`, `campaigns`, `trackedLinks`, `conversionEvents`, `brandLearnings`, `optimizationRecommendations`, `intelligenceJobs`, `strategistConversations`, `aiArtifacts`, `aiUsageDaily`, `contentFingerprints`, `audienceSnapshots`, `audienceDriftEvents` | intelligence surface | Preview-gated at the route layer. |
| `socialPosts`, `rawPlatformMetrics`, `analyticsDaily`, `analytics`, `nativeImportCursors`, `channelHealthNotices` | analytics worker | Derived data. |
| `inbox` | app + worker | Per-user notifications. |
| `idempotency_keys` | public API | Hashed keys; TTL 24h. |
| `jobs` | worker | Scheduled job definitions. |
| `integrations`, `connections` (via `firestore-paths.ts`) | OAuth routes | Tokens stored encrypted. |

### Root-level

These sit outside the workspace tree and deserve the closest attention.

| Collection | Written by | Read by | Why root-level |
| --- | --- | --- | --- |
| `trackedLinks/{code}` | tracked-links routes (batch with the workspace copy) | `/r/[code]` redirect, **unauthenticated route, Admin SDK** | The redirect knows only the code, not the workspace. The route is public; the collection is not: rules still deny direct access, and the route exposes only a 302 (or 410), never document data. |
| `conversionClicks/{clickId}` | `/r/[code]` (unauthenticated, rate-limited + bot-filtered) | attribution model | No raw IP/UA/referrer stored, 90-day TTL. |
| `subscriptions` | Stripe webhook + billing routes | entitlement checks | Stripe-signed writes only. |
| `usage` | metering helpers | quota checks | Counters only. |
| `oauth_states` | OAuth authorize/callback | callback | Short TTL, signed state. |
| `_authOtps` | OTP sign-in | OTP verify | Hashed codes, TTL. |
| `_rateLimits` | rate limiter | rate limiter | Counters only. |
| `_workerLeases`, `_workerSchedules`, `_publishLocks`, `_dueWorkspaces`, `_tokenRefreshQueue` | worker | worker | Coordination state. |
| `_featureFlags` | operators (console) | preview gate | Read-only from code. |
| `_platformCapabilityAudits`, `_platformCapabilityAuditSchedules`, `_rollouts` | ops tooling | ops tooling | |
| `events` | **nothing** (subsystem removed, 3.14) | nothing | Orphaned data may remain in production; export before deleting the collection. Rules deny access either way. |

## The matrix's one rule

Every collection above is deny-by-default at the rules layer and reachable
only through a route that authenticates and authorizes. When that stops being
true for some collection (a future client-side feature), the allowlist entry
in `firestore.rules` is the place to grant it, next to a security review, and
this file is the place to record why.
