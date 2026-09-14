# Production cost and worker guardrails

Production guardrails were applied on 2026-08-18 for project
`markaestro-0226220726`.

## Billing budget

The project has a dedicated recurring monthly budget named
`Markaestro project monthly ($70)`, filtered to this project only. It alerts at
50%, 80%, and 100% of actual spend, plus 100% of forecasted spend. Notifications
go to the Markaestro operations email channel and to the billing account's
default IAM recipients.

A Google Cloud budget is an alert, not a hard spending cap. It does not disable
the application or stop resources automatically.

## Usage alerts

Cloud Monitoring sends the following alerts to `Markaestro Operations Email`:

| Alert | Threshold | Why |
| --- | --- | --- |
| Worker queue backlog | More than 100 queued workspace tasks for 5 minutes | Detects dispatch capacity or target failures before scheduled work becomes stale |
| Worker task failures | More than 5 non-success attempts in 5 minutes | Detects a broken task target even at low traffic |
| Firestore read spike | More than 50,000 billable document reads in one hour | Roughly twice the observed pre-due-queue hourly baseline; catches accidental scans and request loops |
| Cloud Run billable-time spike | More than 3,600 aggregate billable instance-seconds in one hour | Detects sustained average capacity above one instance across revisions |

The read and billable-time thresholds are deliberately based on observed
production usage, not product quotas. Revisit them after normal traffic grows;
do not simply raise them until the source of a sustained alert is understood.

## Queue limits

`markaestro-workspace-ticks` is in `us-central1` with 10 dispatches/second, 50
concurrent dispatches, and three attempts using 10–60 second backoff. These are
cost and load controls as well as throughput settings. Increase them only when
queue-age data shows real demand and the worker target remains healthy.

## X API spend gate

X uses pay-per-use pricing, so every X adapter read, create, and delete reserves
an estimated cost in `workspaces/{workspaceId}/providerUsage/{month}_x` before
opening a provider request. The budget check and reservation share one
Firestore transaction, so concurrent workers cannot spend through the same
remaining allowance. All paid X operations return
`CHANNEL_BILLING_ACTION_REQUIRED` when the next reservation would exceed
`X_API_WORKSPACE_HARD_BUDGET_USD`.

Post lookups also create a hashed daily reservation marker in
`providerUsageDedupe`. X bills the same Post resource once per UTC day, so
repeated scheduled and on-demand metrics reads still increment request counts
but reserve estimated spend only once. The markers expire after 35 days.

Page reads (the native post importer) cannot know their resource count before
the response, so they reserve a full page up front and then settle against the
Posts X actually returned, writing the same daily markers. Two consequences
worth keeping: a page whose `start_time` window matched nothing settles to
zero, and a Post already charged today by either path is free to the other.

The importer passes its own cutoff to the adapter as `sinceIso`, which the X
adapter sends as `start_time`. Any adapter that can filter server-side must do
the same: on a per-resource price sheet, history fetched only to be discarded
client-side is paid for. An idle connected account therefore costs its daily
follower read and nothing else.

Keep the unit-price variables aligned with the active X developer-console
price sheet:

- `X_API_BASIC_WRITE_COST_USD`, default `0.015`
- `X_API_URL_WRITE_COST_USD`, default `0.20`
- `X_API_READ_COST_USD`, default `0.001` per owned post resource
- `X_API_USER_READ_COST_USD`, default `0.001` per owned user resource
- `X_API_DELETE_COST_USD`, default `0.01`

Pricing is operational configuration, not a compile-time promise. Confirm the
[current X API pricing](https://docs.x.com/x-api/getting-started/pricing) before
changing these values. The Firestore counter is a guardrail and usage estimate;
the X developer console remains the billing source of truth.

## Verification commands

```bash
gcloud billing budgets list --billing-account=016D62-E1839D-C56E2D
gcloud alpha monitoring policies list --project=markaestro-0226220726
gcloud tasks queues describe markaestro-workspace-ticks \
  --location=us-central1 \
  --project=markaestro-0226220726
```
