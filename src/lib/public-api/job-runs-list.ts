/**
 * Listing job runs.
 *
 * `GET /api/public/v1/job-runs/[id]` could fetch a run by id and nothing
 * could enumerate them, so a client that lost a run id had no way to recover
 * it: the run existed, was still progressing, and was unreachable.
 *
 * Kept out of `publish-runs.ts` (which owns the run lifecycle) because this is
 * purely a read projection for the API surface.
 */

import { adminDb } from '@/lib/firebase-admin';
import { executeListQueryPage, type FieldFilter } from '@/lib/firestore-list-query';
import { assertPublicPostInBrandScope, getPublicPost } from './posts';

export type ListJobRunsOptions = {
  cursor?: string;
  limit?: number;
  status?: string;
  resourceId?: string;
};

export function serializeJobRun(run: { id: string } & Record<string, unknown>) {
  return {
    id: run.id,
    type: run.type,
    status: run.status,
    message: run.message || '',
    resourceType: run.resourceType,
    resourceId: run.resourceId,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    details: run.details || {},
    createdAt: run.createdAt,
  };
}

/**
 * A run carries no brand of its own: it inherits the brand of the post it acts
 * on. A brand-bound key therefore has to resolve each run's post to prove
 * ownership, exactly as the single-run route does. Runs whose post has since
 * been deleted are dropped for a bound key (ownership is unprovable) and kept
 * for an unbound workspace key.
 */
async function filterRunsToBrand<T extends Record<string, unknown>>(
  workspaceId: string,
  runs: T[],
  keyProductId: string,
): Promise<T[]> {
  const decisions = await Promise.all(runs.map(async (run) => {
    const resourceId = typeof run.resourceId === 'string' ? run.resourceId : '';
    if (run.resourceType !== 'post' || !resourceId) return false;
    try {
      assertPublicPostInBrandScope(await getPublicPost(workspaceId, resourceId), keyProductId);
      return true;
    } catch {
      return false;
    }
  }));
  return runs.filter((_, index) => decisions[index]);
}

export async function listJobRuns(
  workspaceId: string,
  keyProductId: string | undefined,
  options: ListJobRunsOptions = {},
) {
  const filters: FieldFilter[] = [];
  if (options.status) filters.push({ field: 'status', op: '==', value: options.status });
  if (options.resourceId) filters.push({ field: 'resourceId', op: '==', value: options.resourceId });

  const page = await executeListQueryPage<Record<string, unknown>>(
    adminDb.collection(`workspaces/${workspaceId}/job_runs`),
    {
      filters,
      orderByField: 'createdAt',
      orderByDirection: 'desc',
      limit: options.limit ?? 25,
      cursor: options.cursor,
    },
  );

  const visible = keyProductId
    ? await filterRunsToBrand(workspaceId, page.items, keyProductId)
    : page.items;

  return { runs: visible.map(serializeJobRun), nextCursor: page.nextCursor };
}
