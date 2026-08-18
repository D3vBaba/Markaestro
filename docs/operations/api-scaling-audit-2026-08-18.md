# API and request-flow scaling audit — 2026-08-18

## Conclusion

The concern was accurate. The application had both browser request fan-out and
server-side read/write amplification. The most expensive cases were not the
number of HTTP endpoints alone: repeated bootstrap calls, eager route
prefetching, unbounded Firestore reads, per-provider connection re-reads,
transactional telemetry, large in-process uploads, and workers that repeatedly
scanned every workspace all compounded each request.

This change set removes or bounds the high-frequency problems while preserving
the established response shapes and legacy upload routes. Infrastructure
changes are deliberately documented but not applied by this code audit.

## Before and after

| Flow | Before | After this change |
| --- | --- | --- |
| Authenticated app bootstrap | Workspace, subscription, onboarding, and page-data requests; visible navigation links were also eligible for automatic prefetch | Workspace + one shared bootstrap + page data; the app shell persists between app routes and navigation fetches on demand |
| Content draft tab | 3 HTTP requests and up to 1,000 documents per request (up to 3,000) | 1 HTTP request, 60 documents initially, opaque cursor for later pages |
| Scheduled/published content | Up to 1,000 documents on initial load per tab | 60 initially, then cursor pages |
| Dashboard | One HTTP request, but full product and post collections were downloaded and reduced in memory | One HTTP request; 25 count aggregations plus two `limit(5)` recent queries, independent of collection size |
| Warm public-API authentication/accounting | About 6 Firestore reads and 5 writes: key + membership reads, two rate-limit transactions, separate `lastUsedAt`, and a two-read telemetry transaction | 2 rate-limit reads and normally 4 writes in two batched/transactional round trips; key and membership reads are cached for 15 seconds. A cold instance/request adds 2 reads |
| Public post/product lists | Filtering and limiting could return incomplete results or require large reads; no stable cursor | Server filtering, deterministic order (`createdAt` + document ID), maximum 100, opaque cursor, additive `nextCursor` |
| Destination discovery | The same connection collection could be read once per provider/product | Concurrent provider resolution shares one in-flight collection read; known product and Meta credential records are reused |
| Batch/fan-out create | Some operations were sequential; Connect destination count was unbounded | Concurrency 4 with input order retained; native batch maximum 25 and Connect maximum 25 destinations/35 media assets |
| Idempotency | Caller key was used as a document path and simultaneous retries could both execute | Fixed-length hashed IDs, transactional 10-minute reservation, request-hash conflict detection, 24-hour TTL, and temporary legacy replay lookup |
| TikTok polling | Each fast tick enumerated all workspaces and searched their posts | Top-level due queue, at most 50 polls/tick with concurrency 5 and 1m→15m / 15m→24h backoff. A ten-slot legacy migration scan ends 2026-08-25; query failure retains the fallback |
| Public publish/webhook queues | Broad status scans and no claim lease for deliveries | Due-time indexes, limits of 20 publish runs/25 deliveries per workspace, delivery claim leases, concurrency 5, and a 10-second outbound webhook timeout |
| Worker overlap | Scheduler overlap could execute the same global tick twice | Transactional expiring worker leases on both worker endpoints |
| Browser media upload | Up to 250 MB buffered inside a 1 GiB, concurrency-80 application instance | Direct-to-Storage create/finalize flow implemented behind a disabled flag; exact type/size verification, quota refund, retry recovery, staging lifecycle, and TTL sessions. Existing multipart remains the default |
| Ephemeral data | Several retry/lease/session collections could grow indefinitely | Writers use Firestore timestamps and the required TTL collection groups are documented |

## Compatibility protections

- Existing JSON fields and endpoints remain; cursor fields are additive.
- The established multipart upload endpoint is still enabled and remains the
  default while direct upload CORS/IAM is prepared.
- List queries fall back to the previous compatible read/sort path when a new
  composite index is not yet available. Deploy indexes before application code
  so this fallback is brief on large collections.
- Old raw idempotency records and old TikTok posts are read during a bounded
  rollout window.
- Webhook and publish-run workers temporarily include legacy records without
  `nextAttemptAt`; after 2026-08-25 their steady state is one due query.
- Worker execution endpoints and authentication headers are unchanged.

## Re-audit findings still requiring work

### P1 — deploy the declared Firestore indexes before the application

The read-only live validator currently reports **30 passing and 13 missing**
query shapes. All 13 are declared in `firestore.indexes.json`; they are simply
not deployed to the live project. Until they finish building, compatibility
fallbacks preserve results but may read a complete matching collection.

Run `firebase deploy --only firestore:indexes`, wait for every index to become
ready, and rerun `npm run validate:queries`. Do not deploy the list/queue code
first on a large dataset.

### P1 — activate direct uploads, then add the same facility to the public API

The browser direct-upload implementation is intentionally disabled. Apply
`storage.cors.json`, `storage.lifecycle.json`, and the runtime service account's
blob-signing permission, smoke-test, then set
`NEXT_PUBLIC_DIRECT_MEDIA_UPLOADS_ENABLED=1`.

The public `/api/public/v1/media` route still accepts a compatibility multipart
upload up to 250 MB and buffers it in memory. Add a public-API upload-session
surface using the same Storage staging/finalize design, retain multipart for
old clients, and encourage SDKs to migrate. Until then, concurrent large public
uploads remain the clearest memory-exhaustion risk under the current 1 GiB /
concurrency-80 runtime configuration.

### P1/P2 — replace the all-workspace dispatcher

`/api/worker/tick` and OAuth refresh still enumerate every workspace; each
workspace tick also performs several empty due queries. TikTok polling no
longer does this in steady state, but the main worker's cost remains
`O(workspaces + products + connections)` even when most tenants are idle.

Use the existing `/api/worker/workspace/[workspaceId]` endpoint as a Cloud Tasks
target before the dispatcher approaches its request deadline. Cloud Tasks
provides isolated retries and horizontal execution. At the next scale stage,
have writers maintain a `worker_due_workspaces` or workload-specific due queue
so the dispatcher stops scanning idle workspaces entirely. The detailed rollout
is in `docs/operations/worker-fanout.md`.

### P2 — move high-rate limiting and counters out of single Firestore hot docs

Combining the two limits and replacing telemetry transactions materially
reduces present load. The global per-client rate bucket and daily client counter
are still single documents. Watch transaction retries/`ABORTED` errors and write
latency. When clients sustain several requests per second or many instances
contend on the same keys, move rate limiting to Redis/Memorystore and shard or
asynchronously aggregate usage counters.

### P2 — materialize dashboard counters if dashboard traffic becomes material

The dashboard no longer scales with total post count, but it performs 25
parallel count aggregations and two small document queries per request. This is
safe for current data growth, not the cheapest endpoint at high request volume.
Maintain a workspace/day/channel rollup on post transitions when dashboard
traffic justifies replacing those aggregation RPCs.

### P2 — cap webhook endpoint count and paginate administration lists

Delivery processing is bounded, but one event still reads all active webhook
endpoints and creates one delivery per matching endpoint. Define a plan-based
endpoint maximum before customers can create hundreds. Settings-only API-client,
team, invite, and webhook administration lists are also unpaginated; they are
not hot paths today but should receive cursor pagination before enterprise-size
workspaces.

## Deployment sequence

1. Deploy `firestore.indexes.json`; wait until `npm run validate:queries` is
   fully green.
2. Apply the TTL policies in `docs/operations/firestore-ttl.md`.
3. Deploy the application with direct media uploads still set to `0`; smoke-test
   existing app and public API flows.
4. Apply Storage CORS/lifecycle and signing IAM, test a preview revision, then
   flip the direct-upload flag to `1`.
5. Monitor and size the main worker, then introduce Cloud Tasks/due-workspace
   dispatch before its duration becomes a user-facing publish delay.

## Verification performed

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Local production-bundle smoke test: `/api/health` returned 200 and a
  protected `/api/posts` request without credentials returned 401
- JSON parsing for Firestore index and Storage policy files
- `git diff --check`
- Read-only live Firestore query validation (`30 passed`, `13 await deployment`)

No application revision, Firestore index/TTL policy, bucket CORS/lifecycle
policy, or IAM change was deployed as part of this audit.
