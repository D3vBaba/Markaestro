export type JobType = 'sync_contacts' | 'publish_post' | 'refresh_tokens';

export type JobDoc = {
  workspaceId: string;
  name: string;
  type: JobType;
  enabled: boolean;
  schedule: 'manual' | 'daily';
  hourUTC?: number;
  minuteUTC?: number;
  payload: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type JobRun = {
  workspaceId: string;
  jobId: string;
  status: 'started' | 'success' | 'failed';
  message: string;
  startedAt: string;
  finishedAt?: string;
};
