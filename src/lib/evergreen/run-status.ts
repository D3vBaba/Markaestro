import type { EvergreenRun } from './types';

/** Read current publication state without a separate evaluation worker. */
export function evergreenRunStatus(run: Pick<EvergreenRun, 'status'>, postStatus: unknown): EvergreenRun['status'] {
  // Historical evaluations and explicit run cancellations remain part of the record.
  if (['evaluated', 'skipped', 'failed'].includes(run.status)) return run.status;
  if (postStatus === 'published' || postStatus === 'failed' || postStatus === 'scheduled') return postStatus;
  return run.status;
}
