# Intelligent Evergreen and Channel Expansion Implementation Plan

> 2026-09-04 update: Performance-driven cadence changes, caption retirement, decay pauses, and the separate candidate-suggestion worker were removed. Queues retain fixed intervals and operational safeguards. The performance-evaluation sections below describe the original design; see `docs/API_CHANGELOG.md` for current behavior.

Status: Application implementation complete; infrastructure and provider rollout pending  
Design: `docs/design/intelligent-evergreen-and-channel-expansion.md`  
Last updated: 2026-09-03

## Outcome

Ship the Intelligent Evergreen Engine as Markaestro's differentiator and add X through the same capability-driven architecture. YouTube and Reddit are deferred roadmap items only. They are not part of the current implementation and must not appear on the public website, public API, public documentation, or customer-facing channel selectors.

This plan assumes one production repository, the existing Next.js 16 and Firebase architecture, and no rewrite of the publisher or Intelligence system.

## Recommended sequence

```text
External access work
  X billing/account setup

Engineering critical path
  settingsByChannel + generic platform operations
    -> Evergreen foundation
      -> Evergreen worker and calendar
        -> Evaluation and rollout
    -> X

Deferred internal roadmap
  YouTube readiness and implementation
  Reddit readiness and implementation
```

Evergreen and X can proceed in parallel after the shared prerequisites if more than one engineer is available.

## Effort summary

| Workstream | Estimated engineering effort | External dependency |
| --- | ---: | --- |
| Shared platform prerequisites | 2 to 3 weeks | None |
| Intelligent Evergreen V1 | 7 to 9 weeks | Existing Intelligence rollout must be available to target workspaces |
| X | 4 to 6 weeks | Developer account, credits, terms review |
| YouTube, deferred roadmap | 6 to 9 weeks | Separate approval, Google verification, and compliance audit |
| Reddit, deferred roadmap | 4 to 10 weeks | Separate approval, Reddit authorization, policy and media validation |

These are engineer-weeks, not calendar promises. Current delivery covers Evergreen and X only. Deferred estimates do not authorize implementation or public exposure.

## Delivery snapshot

Implemented in this repository:

- Per-channel settings with legacy fallback across app, Public API, MCP, OpenAPI, and both SDKs.
- Intelligent Evergreen queue storage, evidence, scheduling, deterministic generation, review policy, plan limits, downgrade reconciliation, evaluation, notifications, webhooks, lifetime analytics, UI, calendar lineage, and public integrations.
- X OAuth, publishing for text/images/video/GIF, deletion, post discovery, audience and post metrics, rate-limit handling, and atomic paid-usage reservations with a workspace hard budget.
- Capability parity validation, Firestore index definitions, generated API documentation, and regression coverage.

Remaining release gates are external or operational: deploy the committed Firestore indexes, provide production X credentials and budget values, complete provider terms review, run provider smoke tests, and stage the customer rollout. The generic `platformOperations` state model is present, but X currently performs media-processing polls within the existing publish worker; moving all providers to resumable cross-tick polling remains a reliability follow-through rather than a customer-visible feature gap.

## Phase 0: Product, legal, and provider readiness

Estimated effort: 3 to 5 working days of internal work, with external lead time running in parallel.

### Decisions

- [x] Use `Intelligent Evergreen` for user-facing copy and `evergreen` for code identifiers.
- [x] Enforce Pro at 10 active queues per brand and Business unlimited.
- [x] Treat activation as durable authorization for future core-platform runs.
- [x] Keep YouTube and Reddit outside the current implementation and public surfaces.
- [x] Implement a configurable workspace hard budget with operation-specific estimated X costs.
- [x] Expose brand-scoped Public API and MCP queue operations with explicit activation confirmation.

### External readiness

- [ ] Create or validate the X developer project, enable OAuth 2.0, purchase test credits, and configure spend limits.
- [ ] Review X terms for metric retention, derived recommendations, and AI processing.
- [ ] Create dedicated X test accounts and a provider smoke-test matrix.

### Exit criteria

- Product decisions are recorded.
- Secrets, redirect URIs, test accounts, and provider owners are identified.
- Engineering may build against sandboxes without implying production approval.

## Phase 1: Shared post and platform foundations

Estimated effort: 2 to 3 weeks.

### 1.1 Per-channel settings

Primary files:

- `src/lib/schemas.ts`
- `src/lib/public-api/post-settings.ts`
- `src/lib/public-api/schemas.ts`
- `src/lib/public-api/posts.ts`
- `src/lib/public-api/response-schemas.ts`
- `src/lib/social/publisher.ts`
- `src/app/api/posts/route.ts`
- `src/app/api/posts/[id]/route.ts`
- `openapi/markaestro-v1.json`
- TypeScript and Python SDK models

Work:

- [x] Add `settingsByChannel: Partial<Record<SocialChannel, PostSettings>>`.
- [x] Read with `settingsByChannel[channel] ?? settings` everywhere.
- [x] Let Public API multi-target posts carry one settings object per target.
- [x] Preserve the legacy single-channel `settings` response during migration.
- [x] Update create, update, validation, serialization, docs, SDKs, MCP rules, and tests.
- [ ] Add a one-time optional backfill script for single-channel records.

Acceptance criteria:

- A multi-target Instagram and TikTok post can store independent settings.
- Existing posts and SDK consumers remain readable.
- A settings discriminator can never be applied to the wrong channel.
- OpenAPI generation and compatibility tests pass.

### 1.2 Generic asynchronous platform operations

Primary files:

- `src/lib/platform/types.ts`
- `src/lib/social/publisher.ts`
- `src/lib/workers/workspace-tick.ts`
- `src/lib/workers/due-workspaces.ts`
- New `src/lib/platform/operations.ts`
- New `src/lib/platform/operation-poller.ts`

Work:

- [x] Add the `platformOperations` post subcollection and typed state machine.
- [ ] Generalize pending processing beyond TikTok.
- [x] Add resumable checkpoints, next poll time, attempt count, expiry, and classified errors.
- [x] Preserve denormalized post status and `publishResults` for current clients.
- [ ] Add due-workspace discovery for pending platform operations.
- [ ] Migrate TikTok's pending processing incrementally or provide a compatibility adapter.

Acceptance criteria:

- A simulated multi-step video upload can fail, resume, and complete without duplicate publication.
- A stale operation lease is recoverable.
- A permanent operation failure does not retry forever.
- Existing TikTok publish tests stay green.

### 1.3 Capability and cost model

Primary files:

- `src/lib/platform/capabilities.ts`
- `src/lib/platform/channel-limits.ts`
- `src/lib/platform/capability-audit.ts`
- `docs/operations/social-intelligence.md`
- `docs/operations/cost-guardrails.md`

Work:

- [x] Add async publishing, destination discovery, evergreen policy, retention policy, cost model, and budget-key fields.
- [x] Add provider and capability rollout flags.
- [x] Add validation that every social channel has a complete capability contract.
- [x] Add cost counters and a hard threshold; configure soft spend alerts during production rollout.

### Phase 1 release gate

- `npm run ci` and production build pass.
- Existing platform publishing has no behavioral regression.
- Migration can be deployed before any new channel is visible.

## Phase 2: Evergreen domain foundation

Estimated effort: 1.5 to 2 weeks.

### Files

Create:

- `src/lib/evergreen/schemas.ts`
- `src/lib/evergreen/types.ts`
- `src/lib/evergreen/eligibility.ts`
- `src/lib/evergreen/evidence.ts`
- `src/lib/evergreen/scheduling.ts`
- `src/lib/evergreen/storage.ts`
- `src/app/api/evergreen-queues/route.ts`
- `src/app/api/evergreen-queues/preview/route.ts`
- `src/app/api/evergreen-queues/[id]/route.ts`
- `src/app/api/evergreen-queues/[id]/activate/route.ts`
- `src/app/api/evergreen-queues/[id]/pause/route.ts`
- `src/app/api/evergreen-queues/[id]/resume/route.ts`
- `src/app/api/evergreen-queues/[id]/runs/route.ts`

Modify:

- `src/lib/rbac.ts`
- `src/lib/stripe/plans.ts`
- `src/lib/stripe/entitlements.ts`
- `src/lib/media/asset-store.ts`
- `firestore.indexes.json`
- `docs/operations/data-access.md`

### Work

- [x] Add queue, variant, run, evidence, and lineage schemas.
- [x] Add preview-only eligibility and schedule recommendation.
- [x] Add optimistic queue versioning.
- [x] Add immutable activation evidence.
- [x] Add media reference retention for active queues.
- [x] Add `evergreen.read` and `evergreen.manage` permissions.
- [x] Add `evergreenQueuesPerBrand` and server-side plan enforcement.
- [x] Implement activate, pause, resume, archive, and cancel-future behavior.
- [x] Add audit records for every state transition.

### Acceptance criteria

- A user can create a draft queue without scheduling anything.
- Activation requires verified email, publish permission, entitlement, valid source, media, and destinations.
- Two concurrent activations produce one active queue state.
- A plan downgrade pauses excess queues deterministically and preserves data.
- Archiving releases queue-held media only after future occurrences release their own references.

## Phase 3: Evergreen generation worker

Estimated effort: 1.5 to 2 weeks.

### Files

Create:

- `src/lib/evergreen/worker.ts`
- `src/lib/evergreen/preflight.ts`
- `src/lib/evergreen/runs.ts`
- `src/lib/evergreen/link-health.ts`

Modify:

- `src/lib/workers/due-workspaces.ts`
- `src/lib/workers/workspace-tick.ts`
- `src/lib/social/publisher.ts`
- `src/lib/social/publish-attempts.ts`
- `src/lib/analytics/metrics-poller.ts`

### Work

- [x] Add `evergreen_queue` and `evergreen_evaluation` due reasons.
- [x] Claim due queues transactionally with deterministic run ids.
- [x] Generate one ordinary post 48 hours ahead.
- [x] Rotate variants deterministically.
- [x] Use cached learned timing with fixed-time fallback.
- [x] Re-run entitlement, freshness, media, destination, and channel preflight.
- [x] Create drafts for review-each-run targets.
- [x] Advance `nextRunAt` from planned time and avoid schedule drift.
- [x] Add pause-on-permanent-failure and bounded retry behavior.

### Acceptance criteria

- Retrying any step creates no duplicate run or post.
- Generated occurrences use the existing scheduler and publisher only.
- Pausing never changes a post already publishing or published.
- Manual-reminder targets remain manual.
- DST, leap day, conflict, and worker-delay tests pass.
- A failed link check cannot become an SSRF path or block the full workspace tick.

## Phase 4: Evergreen product experience

Estimated effort: 1.5 to 2 weeks.

### Files

Create:

- `src/app/(app)/content/_components/EvergreenTab.tsx`
- `src/components/evergreen/EvergreenQueueWizard.tsx`
- `src/components/evergreen/EvergreenQueueCard.tsx`
- `src/components/evergreen/EvergreenEvidence.tsx`
- `src/components/evergreen/EvergreenRunHistory.tsx`
- `src/messages/*/appEvergreen.json`

Modify:

- Published post actions and cards
- Intelligence opportunity actions
- Content page tabs
- Calendar event rendering
- App navigation and inbox notifications

### Work

- [ ] Build the six-step creation and activation flow from the design.
- [ ] Add queue list, detail, pause, resume, edit, and archive.
- [x] Add occurrence badges and source/queue lineage in Calendar.
- [x] Add evidence, fallback, unavailable-metric, and insufficient-data states.
- [x] Add server-enforced plan limits and deterministic downgrade states.
- [ ] Add keyboard, screen-reader, mobile, and reduced-motion QA.
- [ ] Translate all new copy and run the copy checker.

### Acceptance criteria

- A user can understand what will publish, where, when, and why before activation.
- Every generated occurrence is discoverable from both queue and calendar.
- No unavailable metric is displayed as zero.
- Review-each-run is unmistakable and cannot auto-publish.

## Phase 5: Evaluation, analytics, and webhooks

Estimated effort: 1 to 1.5 weeks.

### Files

Create:

- `src/lib/evergreen/evaluation.ts`
- `src/lib/evergreen/analytics.ts`

Modify:

- `src/lib/analytics/worker.ts`
- `src/lib/intelligence/product-state.ts`
- Analytics and Intelligence page data shapes
- `src/lib/public-api/scopes.ts`
- `src/lib/public-api/webhooks.ts`
- Webhook docs and tests

### Work

- [x] Evaluate at a comparable seven-day metric age.
- [x] Compute normalized performance without fabricating missing data.
- [x] Implement the conservative two-run decay pause.
- [x] Add source, run, and queue-lifetime analytics.
- [x] Attribute clicks and conversions per occurrence and roll them up by queue.
- [x] Emit queue and run webhooks.
- [x] Notify on needs-review, permanent skip, decay pause, and completion.

### Acceptance criteria

- Evaluation never runs against immature or incomparable snapshots.
- Platform analytics outages cannot trigger performance-decay pause.
- Queue totals reconcile exactly with their occurrence records.
- Webhook payloads contain ids and reasons, not captions or raw provider data.

## Phase 6: Evergreen rollout and API follow-through

Estimated effort: 0.5 to 1 week plus observation.

- [ ] Shadow-compute eligibility and generation for internal brands.
- [ ] Run an allowlist with at least 50 generated occurrences.
- [ ] Verify zero duplicate posts and review every pause reason.
- [ ] Release to a small percentage of Pro and Business workspaces.
- [x] Add Public API routes, scopes, OpenAPI, SDK support, and MCP tools.
- [ ] Update pricing and marketing copy after entitled GA.

Go/no-go metrics:

- No duplicate occurrence incidents.
- At least 95 percent of eligible generated runs pass preflight.
- Less than 5 percent of occurrences are deleted as stale before publish.
- No material increase in platform policy errors or user reports.
- X remains deploy-time gated until its production credentials and smoke tests pass. YouTube and Reddit remain roadmap-only and absent from product and public surfaces.

## Phase 7: X

Estimated effort: 4 to 6 weeks after Phase 1.

### Implementation

- [x] Add `x` to shared enums, catalog, capability registry, icons, previews, messages, onboarding, docs, and tests.
- [x] Add X OAuth 2.0 PKCE config, callback identity lookup, refresh, disconnect, and reconnect.
- [x] Implement text and simple image publishing.
- [x] Implement chunked video/GIF upload with bounded processing polls.
- [x] Add deletion, list-posts, audience, and metrics support.
- [x] Add X-specific rate-limit reset handling.
- [x] Add atomic paid-usage reservations, configurable cost estimates, and a hard circuit breaker.
- [x] Add a conservative X evergreen policy.

### Release slices

1. Internal text-only publish.
2. Images and delete.
3. Video/GIF processing.
4. Metrics and audience.
5. Evergreen allowlist.
6. Public API/MCP and GA.

### Exit criteria

- 100 consecutive test publishes without duplicate creation.
- Cost attribution reconciles with the X developer console within an agreed tolerance.
- A zero-credit condition produces one actionable failure and no retry storm.
- Rich metrics stop or degrade honestly after their documented window.

## Deferred roadmap: YouTube (not implemented)

Estimated effort: 6 to 9 weeks after Phase 1, with audit work in parallel.

### Implementation

- [ ] Add YouTube enums, catalog, capability contract, preview, messages, docs, and tests.
- [ ] Implement Google OAuth, offline refresh, explicit channel identity, and Brand Account handling.
- [ ] Add required title, category, privacy, and made-for-kids settings.
- [ ] Build dedicated resumable upload tasks with checkpoints.
- [ ] Poll processing and preserve partial thumbnail failure.
- [ ] Add custom thumbnail, optional playlist placement, delete, and list-posts.
- [ ] Add YouTube Analytics targeted queries and channel audience.
- [ ] Add upload quota reservation and forecasting.
- [ ] Add 30-day authorization and metadata reconciliation.
- [ ] Gate public uploads on recorded audit approval.
- [ ] Add review-each-run evergreen behavior.

### Release slices

1. Private internal upload only.
2. Resumable recovery and processing status.
3. Metadata and thumbnail.
4. Analytics and retention reconciliation.
5. Audit-approved public/unlisted publishing.
6. Evergreen review flow.

### Exit criteria

- A large upload resumes after an injected interruption without restarting or duplicating.
- Public privacy status cannot be selected before the compliance gate opens.
- Daily quota reservations prevent overbooking.
- Deleted videos and revoked authorization reconcile within policy windows.

## Deferred roadmap: Reddit (not implemented)

Estimated effort: 4 to 6 weeks after Phase 1 and approval.

### Implementation

- [ ] Add Reddit enums, capability contract, preview, messages, docs, and tests.
- [ ] Implement OAuth, refresh, disconnect, and required unique User-Agent.
- [ ] Add subreddit destination validation and short-lived rule/requirement/flair cache.
- [ ] Add self and link post settings.
- [ ] Parse structured submission errors even on HTTP 200.
- [ ] Implement deletion and limited honest metrics.
- [ ] Reconcile removal/deletion and apply data-retention rules.
- [ ] Disable native history import and third-party content AI processing.
- [ ] Add review-each-run evergreen behavior with one subreddit target.

### Release slices

1. Internal OAuth and subreddit discovery.
2. Text posts with full requirement validation.
3. Link posts, delete, and moderation state.
4. Limited metrics.
5. Evergreen review flow.
6. Native image/video only after separate product and API validation.

### Exit criteria

- Rule and flair changes between scheduling and publishing produce an actionable review state.
- Moderator removals pause the matching queue.
- No metric is mislabeled as reach or impressions.
- Rate-limit headers drive throttling and no client-wide retry storm occurs.
- Retention and deletion behavior has legal approval and an operational runbook.

## Cross-cutting definition of done

Every phase that reaches production must include:

- Server-side authorization, ownership, entitlement, and rate-limit enforcement.
- Firestore indexes and query validation.
- Unit, integration, contract, and regression tests proportional to risk.
- Structured logs, SLO counters, dashboards, and alerts.
- Kill switch and staged rollout controls.
- Error-code and localization coverage.
- OpenAPI, SDK, Public API, MCP, and webhook updates when their surfaces change.
- Data-access, cost, retention, and incident runbook updates.
- `npm run ci`, production build, emulator checks, and provider smoke tests.

## Recommended first implementation ticket

Start with `settingsByChannel` because it removes a known current limitation and is required by both Evergreen variants and all three new channels.

First pull request acceptance criteria:

- New optional map schema with legacy fallback.
- Public API multi-target settings no longer rejects two channel-specific objects.
- Publisher passes the correct settings object to each adapter.
- Response schemas remain backward compatible.
- Regression tests cover existing TikTok and Instagram settings in one multi-target post.
- Generated OpenAPI, SDK types, and docs are updated.
