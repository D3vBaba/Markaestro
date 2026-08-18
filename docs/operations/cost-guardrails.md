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

## Verification commands

```bash
gcloud billing budgets list --billing-account=016D62-E1839D-C56E2D
gcloud alpha monitoring policies list --project=markaestro-0226220726
gcloud tasks queues describe markaestro-workspace-ticks \
  --location=us-central1 \
  --project=markaestro-0226220726
```
