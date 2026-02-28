export type JobType = 'send_email_campaign' | 'sync_contacts' | 'generate_content';

export type JobDoc = {
  workspaceId: string;
  name: string;
  type: JobType;
  enabled: boolean;
  schedule: 'manual' | 'daily';
  hourUTC?: number;
  minuteUTC?: number;
  payload: Record<string, any>;
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
