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
| Browser media upload | Up to 250 MB buffered inside a 1 GiB, concurrency-80 application instance | Direct-to-Storage create/finalize flow is enabled; exact type/size verification, quota refund, retry recovery, staging lifecycle, and TTL sessions. Existing multipart remains a fallback |
| Public API media upload | Multipart requests could buffer up to 250 MB in the application runtime | Direct-to-Storage upload sessions are the recommended path; exact metadata validation and retry-safe finalization. Multipart remains available for existing integrations |
| Main background worker | Every minute performed work proportional to all workspaces, even when idle | Writers maintain a due-workspace queue; Cloud Tasks executes due work independently. A five-minute legacy scan and in-process fallback protect compatibility |
| Webhook endpoints | An account could create an unbounded fan-out for every event | New endpoint creation is capped at 25 active endpoints per workspace; existing endpoints are unaffected |
| Ephemeral data | Several retry/lease/session collections could grow indefinitely | Writers use Firestore timestamps and the required TTL collection groups are documented |

## Compatibility protections

- Existing JSON fields and endpoints remain; cursor fields are additive.
- The established multipart upload endpoints remain enabled. New browser and
  Public API integrations use direct upload sessions.
- List queries fall back to the previous compatible read/sort path when a new
  composite index is not yet available. Deploy indexes before application code
  so this fallback is brief on large collections.
- Old raw idempotency records and old TikTok posts are read during a bounded
  rollout window.
- Webhook and publish-run workers temporarily include legacy records without
  `nextAttemptAt`; after 2026-08-25 their steady state is one due query.
- Worker execution endpoints and authentication headers are unchanged.

## Re-audit findings still requiring work

### P1 — Firestore indexes (completed in the follow-up release)

The initial read-only live validator reported **30 passing and 13 missing**
query shapes. The follow-up release deployed those indexes and waited for query
serving propagation; the validator now reports **43 passing and 0 missing**.

Future index changes should follow the same order: deploy indexes, wait for
`npm run validate:queries` to pass, then deploy application code.

### P1 — add direct uploads to the public API (completed)

Browser direct uploads are enabled in the follow-up release after applying
`storage.cors.json`, `storage.lifecycle.json`, and verifying the runtime service
account's blob-signing permission. The multipart route remains available to old
clients and as an operational rollback path.

The public API now provides upload-session create/finalize routes using the
same staging, exact metadata verification, quota, retry recovery, Storage
lifecycle, and Firestore TTL controls as the browser. The old multipart route
remains available so existing integrations do not break.

### P1/P2 — replace the all-workspace dispatcher (completed with safety sweep)

The main worker now claims `worker_due_workspaces` records and dispatches them
to the existing per-workspace endpoint through Cloud Tasks. Writers cover
scheduled posts, publish runs, webhook deliveries/retries, analytics polling,
and daily jobs. Cloud Tasks failure falls back to the old in-process execution.
A five-minute all-workspace sweep remains temporarily to recover legacy or
missed markers; extend and eventually remove it only after production evidence
shows no missed work. OAuth maintenance runs every 15 minutes.

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

### P2 — cap webhook endpoint count (completed); paginate administration lists later

New webhook endpoint creation is capped at 25 active endpoints per workspace,
bounding per-event delivery fan-out without removing any existing endpoint.
Settings-only API-client, team, invite, and webhook administration lists remain
unpaginated by design for now: they are cold, naturally small paths and do not
justify added reads or UI complexity before enterprise-size workspaces.

## Deployment sequence

1. Deploy `firestore.indexes.json`; wait until `npm run validate:queries` is
   fully green. **Completed.**
2. Apply the TTL policies in `docs/operations/firestore-ttl.md`. **Completed.**
3. Apply Storage CORS/lifecycle, verify signing IAM, then enable direct browser
   uploads. **Completed in this release.**
4. Deploy and smoke-test existing app and public API flows.
5. Monitor Cloud Tasks queue age and due-marker coverage. Keep the five-minute
   compatibility sweep until a full production scheduling cycle is clean.

## Verification performed

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Local production-bundle smoke test: `/api/health` returned 200 and a
  protected `/api/posts` request without credentials returned 401
- JSON parsing for Firestore index and Storage policy files
- `git diff --check`
- Live Firestore query validation (`43 passed`, `0 failed` after deployment)

The initial audit did not mutate production. Its follow-up release applied the
reviewed index, TTL, CORS, and lifecycle configuration before rolling out the
application revision.
