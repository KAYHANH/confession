export type JobType =
  | 'QUEUE_RESTART'
  | 'SCHEDULE_RECALCULATE'
  | 'QUEUE_REPAIR'
  | 'RECONCILIATION'
  | 'RETRY_FAILED';

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED';

export interface BackgroundJob {
  id: string;
  type: JobType;
  status: JobStatus;
  total: number;
  processed: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  current_step?: string;
  message?: string;
  payload?: any;
  result?: any;
  error?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobProgressResponse {
  success: boolean;
  job: BackgroundJob;
}
