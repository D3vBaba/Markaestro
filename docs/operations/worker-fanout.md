# Worker fan-out

## Current state (default)

`POST /api/worker/tick` is invoked every ~2 min by Cloud Scheduler.
It runs global work (OAuth refresh and OAuth-state cleanup) once per tick,
then fans out per-workspace work in-process with
`mapWithConcurrency` at `WORKER_WS_CONCURRENCY` (default 8) parallel
workers. TikTok polling has a separate due-queue endpoint.

The dispatcher still performs work proportional to total workspace count,
including for idle workspaces. Treat a few hundred workspaces as the planning
boundary, validate it with production duration/read metrics, and switch before
the dispatcher approaches the Cloud Run request timeout.

## Cloud Tasks fan-out (recommended above ~500 workspaces)

1. Create a Cloud Tasks queue:

   ```bash
   gcloud tasks queues create markaestro-workspace-ticks \
     --location=us-central1 \
     --max-concurrent-dispatches=50 \
     --max-dispatches-per-second=10 \
     --max-attempts=3
   ```

2. Grant the service account that runs the dispatcher tick
   `roles/cloudtasks.enqueuer` on the queue.

3. Add a lightweight enqueue helper (requires the `@google-cloud/tasks`
   dependency):

   ```ts
   import { CloudTasksClient } from '@google-cloud/tasks';
   const client = new CloudTasksClient();

   export async function enqueueWorkspaceTick(workspaceId: string) {
     const project = process.env.GCLOUD_PROJECT!;
     const location = 'us-central1';
     const queue = 'markaestro-workspace-ticks';
     await client.createTask({
       parent: client.queuePath(project, location, queue),
       task: {
         httpRequest: {
           httpMethod: 'POST',
           url: `${process.env.NEXT_PUBLIC_APP_URL}/api/worker/workspace/${workspaceId}`,
           headers: { 'x-worker-secret': process.env.WORKER_SECRET! },
         },
         dispatchDeadline: { seconds: 300 },
       },
     });
   }
   ```

4. In the dispatcher tick, replace the `mapWithConcurrency` block with
   bounded-concurrency calls to `enqueueWorkspaceTick`. Dispatch duration and
   task cost still grow with workspace count, but the expensive execution is
   horizontally distributed and independently retryable.

The `/api/worker/workspace/[workspaceId]` endpoint is already live and
accepts the same `x-worker-secret` header, so no API change is needed
on the execution side.

Cloud Tasks solves the single-instance timeout boundary; it does not eliminate
the idle-workspace scan. At larger scale, have writers maintain a top-level
`worker_due_workspaces` queue (or workload-specific due queues) and dispatch
only due workspace IDs. Roll that out with a temporary legacy scan, as used by
the TikTok publish mapping queue.

## Tuning knobs

- `WORKER_WS_CONCURRENCY` — parallelism inside the dispatcher tick.
  Raise when instance CPU/RAM grows; lower if Firestore contention
  shows up as `ABORTED` transaction retries.
- `runConfig.timeoutSeconds` in `apphosting.yaml` — hard upper bound on
  any single dispatcher tick.
- Cloud Scheduler frequency — the current 2 minute cadence matches the
  publisher's freshness target; rarely worth changing.
