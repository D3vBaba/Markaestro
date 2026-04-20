# Worker fan-out

## Current state (default)

`POST /api/worker/tick` is invoked every ~2 min by Cloud Scheduler.
It runs global work (OAuth refresh, OAuth-state cleanup, TikTok publish
poll) once per tick, then fans out per-workspace work in-process with
`mapWithConcurrency` at `WORKER_WS_CONCURRENCY` (default 8) parallel
workers.

This scales cleanly to a few hundred workspaces per instance with
1 vCPU / 1 GiB. Beyond that — or when per-workspace jobs start touching
the Cloud Run per-request timeout — switch to Cloud Tasks fan-out.

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

4. In the dispatcher tick, replace the `mapWithConcurrency` block with a
   simple `for (const ws of wsDocs) await enqueueWorkspaceTick(ws.id)`
   loop. The dispatcher completes in ~1s regardless of workspace count.

The `/api/worker/workspace/[workspaceId]` endpoint is already live and
accepts the same `x-worker-secret` header, so no API change is needed
on the execution side.

## Tuning knobs

- `WORKER_WS_CONCURRENCY` — parallelism inside the dispatcher tick.
  Raise when instance CPU/RAM grows; lower if Firestore contention
  shows up as `ABORTED` transaction retries.
- `runConfig.timeoutSeconds` in `apphosting.yaml` — hard upper bound on
  any single dispatcher tick.
- Cloud Scheduler frequency — the current 2 minute cadence matches the
  publisher's freshness target; rarely worth changing.
