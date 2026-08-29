# Domain SLO alerting

`cost-guardrails.md` covers billing budgets and infrastructure usage alerts,
and `runbooks.md` has the paging chain. Both are infrastructure-shaped: they
fire when the platform is unhealthy.

This document covers the other failure mode, the one that produced every
critical bug in the August 2026 audit: **the product is broken and the
infrastructure is green**. Posts silently stopped collecting metrics. Webhook
deliveries silently dead-lettered. Publishes started failing against an
unchanged platform API. Cloud Run's dashboards showed a healthy service
throughout, and the first signal in every case was a support email.

## How the signal gets out

`src/lib/observability/slo-metrics.ts` emits one structured log line per
counter per workspace tick. Cloud Logging parses the JSON natively, so each
numeric field is directly extractable into a log-based metric. There is no
metrics client, no sidecar, and no extra dependency: a counter is a log line.

Emitting is best-effort and never throws. A counter must not be able to fail
the tick it is measuring.

The `event` field is the metric's identity. **Renaming one orphans its alert
policy silently**, which is exactly the class of failure this document exists
to catch, so treat those strings as a published interface.

| `event` | Emitted from | Numeric fields |
| --- | --- | --- |
| `slo.publish` | workspace tick, after scheduled posts | `publishAttempted`, `publishFailed`, `publishPublished`, `publishRetried` |
| `slo.webhook_delivery` | workspace tick, after delivery batch | `webhookAttempted`, `webhookDelivered`, `webhookDeadLettered` |
| `slo.metrics_staleness` | workspace tick, sampled per tick | `metricsOverduePosts`, `metricsGraceHours` |
| `slo.ai_burn` | workspace tick, sampled per tick | `aiOperationsThisMonth`, `aiMonthlyLimit`, `aiBurnPercent` |
| `slo.channel_health` | channel health sampling | `channelsUnhealthy`, `channelsTokenDegraded` |

Every line also carries `workspaceId`, so each metric can be grouped by tenant
to tell "one customer is broken" apart from "we are broken".

## What pages

### 1. Publish failure rate

`publishFailed / publishAttempted` over 30 minutes, above roughly 20%.

Catches a platform API change or an expired app credential within one tick
instead of one support email. The ratio, not the absolute count: a workspace
publishing four posts an hour and failing all four matters, and a threshold on
raw failures would miss it.

**First move:** open the publish attempt trail
(`workspaces/{ws}/posts/{id}/publishAttempts`, see `IMP-04`) for a failing
post. It records the platform's own error per channel per attempt, which is
what turns "publishing is failing" into "Meta is rejecting our app secret".

### 2. Webhook dead-letter rate

Deliveries reaching `MAX_WEBHOOK_ATTEMPTS` per hour, sustained above zero.

Catches a bad deploy on a customer's side, and also catches an endpoint the
SSRF guard has started refusing, which is otherwise invisible to both parties.

**First move:** the delivery list at
`GET /api/settings/webhook-endpoints/{id}/deliveries` shows `responseCode` and
a truncated `lastError` per attempt. If one workspace dominates, it is theirs;
if the failures span workspaces, it is ours.

### 3. Metrics poller staleness

Count of published posts whose metrics poll is more than
`metricsGraceHours` overdue, above a small per-workspace baseline.

**This is the alert that would have caught `EH-01`.** A post whose
`externalId` was wiped by an edit stops collecting metrics forever: it
disappears from analytics and the post leaderboard, and nothing tells anyone.
Its poll schedule stops advancing, so "overdue and never polled" is precisely
that signature.

**First move:** check whether the affected posts still have an `externalId`.
An empty one on a `published` post means something cleared it, which is a code
bug, not a platform outage.

### 4. AI quota burn rate

`aiBurnPercent` climbing faster than the month is elapsing, per workspace.

Catches a retry loop before it exhausts a customer's month, which nothing
currently prevents (`RL-03`).

**First move:** compare `aiOperationsThisMonth` against the workspace's
`intelligenceJobs` volume. A burn rate with no corresponding jobs is a loop.

## What goes on a dashboard but does not page

- **OAuth connections entering `error` status per day.** One expired Instagram
  token is a customer problem; a hundred in an hour is ours.
- **`channelsTokenDegraded`**, the count of connections running on a
  short-lived token because the long-lived exchange failed (`EH-07`). Each one
  is a connection that will die in about an hour instead of about sixty days.
  Individually harmless, collectively a sign that an app secret rotated.

## Applying the policies

```bash
./scripts/setup-alert-policies.sh
```

The script is idempotent: it creates each log-based metric and alert policy if
absent and leaves existing ones alone. It does not delete policies, so removing
an alert is a deliberate manual act.

Verify with:

```bash
gcloud logging metrics list --project=markaestro-0226220726
gcloud alpha monitoring policies list --project=markaestro-0226220726
```

## A note on thresholds

The numbers above are starting points chosen from the shape of the failures
they are meant to catch, not from observed production distributions, because
these counters did not exist before. Re-derive them from a month of real data
before treating a quiet alert as evidence of health. Do not raise a threshold
to silence a sustained alert until its cause is understood: that is how the
metrics poller went quiet in the first place.
