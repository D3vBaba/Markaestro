# Due-workspace worker dispatch

`POST /api/worker/tick` is invoked every minute by Cloud Scheduler. With the
due queue enabled it claims at most 50 records from the top-level
`worker_due_workspaces` collection and sends one Cloud Task per workspace to
`POST /api/worker/workspace/:workspaceId`. The expensive work therefore runs
independently and can scale across App Hosting instances.

Writers add or advance a due marker when they create scheduled posts, queued
publish runs, webhook deliveries, retry work, or daily jobs. A workspace tick
also records the earliest future work it finds. Queue writes are best-effort:
the user-facing write still succeeds if queue maintenance temporarily fails.

## Compatibility and failure behavior

- Every five minutes, one dispatcher performs the former all-workspace scan.
  This catches legacy data and any missed due marker. It is intentionally a
  temporary safety net and means idle-workspace scans are reduced by about 80%
  immediately, not eliminated yet.
- If Cloud Tasks is disabled or enqueueing fails, the dispatcher processes the
  claimed workspace in-process using the established code path.
- Due records use an expiring dispatch lease and version. Work created while a
  task is running increments the version, so task completion cannot delete the
  newly scheduled work.
- The target endpoint also has a per-workspace lease, preventing overlapping
  execution. Worker operations remain idempotent because Cloud Tasks can
  deliver a task more than once.
- OAuth token refresh and expired-state cleanup run every 15 minutes instead of
  on every scheduler tick. TikTok polling continues to use its separate
  due-queue endpoint.

Disable `WORKER_DUE_QUEUE_ENABLED` to restore the previous all-workspace,
in-process behavior without changing the scheduler or worker target.

## Production configuration

Create the queue in the same region as App Hosting:

```bash
gcloud tasks queues create markaestro-workspace-ticks \
  --location=us-central1 \
  --max-concurrent-dispatches=50 \
  --max-dispatches-per-second=10 \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=60s
```

Grant the App Hosting runtime service account `roles/cloudtasks.enqueuer`, then
configure:

```text
WORKER_DUE_QUEUE_ENABLED=1
WORKER_CLOUD_TASKS_ENABLED=1
WORKER_TASKS_QUEUE=markaestro-workspace-ticks
WORKER_TASKS_LOCATION=us-central1
WORKER_TASKS_TARGET_ORIGIN=https://markaestro--markaestro-0226220726.us-central1.hosted.app
WORKER_LEGACY_SWEEP_INTERVAL_MS=3600000
WORKER_GLOBAL_PHASE_INTERVAL_MS=900000
```

`WORKER_TASKS_TARGET_ORIGIN` deliberately uses the direct App Hosting URL. The
custom-domain proxy is not needed for an internal task and would add another
runtime hop. Tasks authenticate with the existing `x-worker-secret` header.

## Tuning and monitoring

- `WORKER_DUE_BATCH_SIZE` (default 50): due workspaces claimed per scheduler
  tick.
- `WORKER_WS_CONCURRENCY` (default 8): bounded parallelism for enqueue calls or
  in-process fallback.
- `WORKER_LEGACY_SWEEP_INTERVAL_MS` (code default five minutes, deployed value
  one hour): compatibility scan interval. Every sweep runs a full tick for every
  workspace that has no due marker, so a short interval dominates Firestore read
  volume. Shorten it again only while investigating missed due work.
- `WORKER_GLOBAL_PHASE_INTERVAL_MS` (default 15 minutes): OAuth maintenance
  interval.

Watch Cloud Tasks queue depth/oldest-task age, worker 5xx responses, fallback
log event `worker.cloud_tasks_enqueue_fallback`, and the duration of legacy
sweeps. Once no missed due work is observed through a full scheduling cycle,
the compatibility interval can be lengthened and eventually removed.
