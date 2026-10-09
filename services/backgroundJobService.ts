/**
 * services/backgroundJobService.ts — ConfessionFlow Background Job Execution Engine
 *
 * Provides non-blocking, asynchronous execution of long-running operations:
 *  - Queue Restart & Retry Failed
 *  - Queue Repair & Stale Timestamp Recalculation
 *  - Full Publication Reconciliation
 *  - Schedule Recalculation
 *
 * Guarantees:
 *  - Immediate API response (< 100ms) with unique jobId
 *  - Zero synchronous Instagram publishes during queue restart/retry
 *  - Chunked processing (15–25 records) to prevent thread/DB locks
 *  - Atomic cancellation support
 *  - Process recovery on server restarts (stalled jobs marked INTERRUPTED)
 *  - Job concurrency locking
 */

import { mockStore } from '@/lib/mockStore';
import { BackgroundJob, JobType, JobStatus } from '@/types/jobs';
import { Confession, ConfessionStatus } from '@/types';

class BackgroundJobService {
  private cancellationTokens = new Set<string>();

  /**
   * Acquire a job lock and create a job in QUEUED state.
   * Throws if an incompatible job is currently active.
   */
  public createJob(type: JobType, payload?: any): BackgroundJob {
    // 1. Check for active conflicting jobs
    const activeJob = mockStore.getActiveJob();
    if (activeJob) {
      throw new Error(`A background operation is already in progress: ${activeJob.type} (#${activeJob.id}). Please wait or cancel it before starting a new job.`);
    }

    const now = new Date().toISOString();
    const id = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newJob: BackgroundJob = {
      id,
      type,
      status: 'QUEUED',
      total: 0,
      processed: 0,
      success_count: 0,
      skipped_count: 0,
      failed_count: 0,
      current_step: 'Queued in background...',
      message: 'Job initialized and waiting to run.',
      payload: payload || null,
      result: null,
      error: null,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };

    return mockStore.addJob(newJob);
  }

  public getJob(id: string): BackgroundJob | undefined {
    return mockStore.getJobById(id);
  }

  public getActiveJob(types?: JobType[]): BackgroundJob | null {
    return mockStore.getActiveJob(types);
  }

  /**
   * Cancel an in-flight background job safely
   */
  public cancelJob(id: string): BackgroundJob | null {
    const job = mockStore.getJobById(id);
    if (!job) return null;

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return job;
    }

    this.cancellationTokens.add(id);

    const updated = mockStore.updateJob(id, {
      status: 'CANCELLED',
      message: 'Job cancelled by administrator.',
      completed_at: new Date().toISOString(),
    });

    return updated;
  }

  public isCancelled(id: string): boolean {
    return this.cancellationTokens.has(id);
  }

  /**
   * Called during startup: mark any orphaned RUNNING jobs as INTERRUPTED
   */
  public cleanupStalledJobs(): number {
    const jobs = mockStore.getJobs();
    let interrupted = 0;
    const now = new Date().toISOString();

    for (const job of jobs) {
      if (job.status === 'RUNNING' || job.status === 'QUEUED') {
        mockStore.updateJob(job.id, {
          status: 'INTERRUPTED',
          error: 'Job was interrupted due to server restart or reload.',
          message: 'Server restarted while job was in flight.',
          completed_at: now,
        });
        interrupted++;
      }
    }

    if (interrupted > 0) {
      console.log(`[BackgroundJobService] Cleaned up ${interrupted} interrupted background job(s).`);
    }
    return interrupted;
  }

  // ---------------------------------------------------------------------------
  // 1. Asynchronous Queue Restart / Retry Job Worker
  // ---------------------------------------------------------------------------

  public async startQueueRestartJob(options?: { targetIds?: string[] }): Promise<BackgroundJob> {
    const job = this.createJob('QUEUE_RESTART', options);

    // Spawn non-blocking background runner
    setTimeout(() => {
      this.runQueueRestartWorker(job.id, options?.targetIds).catch((err) => {
        console.error(`[BackgroundJobService] Unhandled error in job #${job.id}:`, err);
        mockStore.updateJob(job.id, {
          status: 'FAILED',
          error: err?.message || 'Unexpected job failure',
          completed_at: new Date().toISOString(),
        });
      });
    }, 10);

    return job;
  }

  private async runQueueRestartWorker(jobId: string, targetIds?: string[]): Promise<void> {
    if (this.isCancelled(jobId)) return;
    const startTime = Date.now();
    mockStore.updateJob(jobId, {
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      current_step: 'Identifying and validating eligible confessions...',
      message: 'Scanning failed and quarantined queue records...',
    });

    const all = mockStore.getConfessions();
    const settings = mockStore.getSettings();

    // Gather candidate records
    const candidates = targetIds && targetIds.length > 0
      ? all.filter((c) => targetIds.includes(c.id))
      : all.filter((c) => c.status === 'FAILED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED_REQUIRES_ACTION');

    const totalCandidates = candidates.length;
    mockStore.updateJob(jobId, {
      total: totalCandidates,
      current_step: `Validating ${totalCandidates} records for queue safety...`,
    });

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const CHUNK_SIZE = 25;

    const eligibleToRestart: Confession[] = [];

    // Filter & validate candidates with strict safety rules
    for (const c of candidates) {
      // 1. Strict guard: NEVER touch or reset REJECTED or HIGH risk confessions
      if (c.status === 'REJECTED' || c.moderation_status === 'HIGH') {
        skippedCount++;
        continue;
      }

      // 2. Strict guard: NEVER touch or reset already PUBLISHED or DUPLICATE confessions
      if (
        c.status === 'PUBLISHED' ||
        c.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
        c.instagram_media_id ||
        c.published_at ||
        c.reconciliation_status === 'ALREADY_PUBLISHED' ||
        c.reconciliation_status === 'DUPLICATE'
      ) {
        skippedCount++;
        continue;
      }

      // 3. Strict guard: NEVER restart UNKNOWN without prior reconciliation
      if (
        c.status === 'UNKNOWN' ||
        c.status === 'UNKNOWN_NEEDS_REVIEW' ||
        c.reconciliation_status === 'UNKNOWN' ||
        c.reconciliation_status === 'MANUAL_REVIEW'
      ) {
        skippedCount++;
        continue;
      }

      // 4. Strict guard: skip if currently in PUBLISHING state
      if (c.status === 'PUBLISHING') {
        skippedCount++;
        continue;
      }

      // 5. Exceeded retries without explicit manual action
      if ((c.retry_count || 0) >= 3 && !targetIds) {
        skippedCount++;
        continue;
      }

      eligibleToRestart.push(c);
    }

    mockStore.updateJob(jobId, {
      total: eligibleToRestart.length + skippedCount,
      skipped_count: skippedCount,
      current_step: `Requeuing ${eligibleToRestart.length} safe candidates in controlled batches...`,
    });

    const nextStatus: ConfessionStatus = 'APPROVED'; // Mark APPROVED so scheduler can assign future slots

    // Process eligible records in chunks of 25
    for (let i = 0; i < eligibleToRestart.length; i += CHUNK_SIZE) {
      if (this.isCancelled(jobId)) {
        mockStore.updateJob(jobId, {
          status: 'CANCELLED',
          message: `Job cancelled after processing ${successCount} records.`,
          completed_at: new Date().toISOString(),
        });
        return;
      }

      const chunk = eligibleToRestart.slice(i, i + CHUNK_SIZE);

      for (const confession of chunk) {
        try {
          mockStore.updateConfession(confession.id, {
            status: nextStatus,
            reconciliation_status: 'CONFIRMED_NOT_PUBLISHED',
            scheduled_at: null,
            error_message: null,
            retry_count: 0,
            generated_image_url: null,
            generated_image_path: null,
          });
          successCount++;
        } catch (err: any) {
          failedCount++;
          console.error(`[BackgroundJob] Failed to reset record #${confession.id}:`, err);
        }
      }

      // Update progress after chunk
      mockStore.updateJob(jobId, {
        processed: successCount + skippedCount + failedCount,
        success_count: successCount,
        skipped_count: skippedCount,
        failed_count: failedCount,
        current_step: `Requeued ${successCount} of ${eligibleToRestart.length} records...`,
      });

      // Brief yield to keep Node event loop responsive
      await new Promise((res) => setTimeout(res, 20));
    }

    // Recalculate future queue using canonical AdaptiveSchedulingEngine
    mockStore.updateJob(jobId, {
      current_step: 'Recalculating future schedule slots via Adaptive Cadence...',
      message: 'Applying active hours, gap ranges, and growth strategy...',
    });

    let recalcCount = 0;
    try {
      const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
      const recalcRes = await adaptiveSchedulingEngine.recalculateFutureQueue();
      recalcCount = recalcRes.newlyScheduledCount;
    } catch (schedErr) {
      console.warn('[BackgroundJob] Future queue recalculation warning:', schedErr);
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 100) / 10;

    mockStore.updateJob(jobId, {
      status: 'COMPLETED',
      current_step: 'Completed',
      processed: successCount + skippedCount + failedCount,
      success_count: successCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      message: `Successfully requeued ${successCount} confession(s) (${recalcCount} slots scheduled, ${skippedCount} protected, ${failedCount} errors) in ${durationSeconds}s.`,
      result: {
        restartedCount: successCount,
        recalculatedSlots: recalcCount,
        skippedProtected: skippedCount,
        failedCount,
        durationSeconds,
      },
      completed_at: new Date().toISOString(),
    });

    console.log(`🎉 [BackgroundJobService] Queue Restart job #${jobId} completed in ${durationSeconds}s: ${successCount} requeued, ${recalcCount} scheduled.`);
  }

  // ---------------------------------------------------------------------------
  // 2. Asynchronous Schedule Recalculate Job Worker
  // ---------------------------------------------------------------------------

  public async startRecalculateScheduleJob(): Promise<BackgroundJob> {
    const job = this.createJob('SCHEDULE_RECALCULATE');

    setTimeout(() => {
      this.runRecalculateWorker(job.id).catch((err) => {
        console.error(`[BackgroundJobService] Unhandled error in job #${job.id}:`, err);
        mockStore.updateJob(job.id, {
          status: 'FAILED',
          error: err?.message || 'Schedule recalculation failed',
          completed_at: new Date().toISOString(),
        });
      });
    }, 10);

    return job;
  }

  private async runRecalculateWorker(jobId: string): Promise<void> {
    if (this.isCancelled(jobId)) return;
    mockStore.updateJob(jobId, {
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      current_step: 'Evaluating Growth Cadence Strategy...',
      message: 'Calculating optimal posting slots aligned to active hours...',
    });

    const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
    const result = await adaptiveSchedulingEngine.recalculateFutureQueue();

    mockStore.updateJob(jobId, {
      status: 'COMPLETED',
      total: result.totalScheduled,
      processed: result.totalScheduled,
      success_count: result.newlyScheduledCount,
      current_step: 'Completed',
      message: `Successfully recalculated schedule: ${result.newlyScheduledCount} posts aligned to ${result.strategy}.`,
      result,
      completed_at: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Asynchronous Queue Repair Job Worker
  // ---------------------------------------------------------------------------

  public async startRepairQueueJob(): Promise<BackgroundJob> {
    const job = this.createJob('QUEUE_REPAIR');

    setTimeout(() => {
      this.runRepairWorker(job.id).catch((err) => {
        console.error(`[BackgroundJobService] Unhandled error in job #${job.id}:`, err);
        mockStore.updateJob(job.id, {
          status: 'FAILED',
          error: err?.message || 'Queue repair failed',
          completed_at: new Date().toISOString(),
        });
      });
    }, 10);

    return job;
  }

  private async runRepairWorker(jobId: string): Promise<void> {
    if (this.isCancelled(jobId)) return;
    mockStore.updateJob(jobId, {
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      current_step: 'Scanning for stale or expired scheduled posts...',
      message: 'Repairing schedule timings and fixing expired slots...',
    });

    const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
    const result = await adaptiveSchedulingEngine.repairQueue();

    mockStore.updateJob(jobId, {
      status: 'COMPLETED',
      total: result.repairedCount,
      processed: result.repairedCount,
      success_count: result.repairedCount,
      current_step: 'Completed',
      message: result.reason,
      result,
      completed_at: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Asynchronous Full Reconciliation Job Worker
  // ---------------------------------------------------------------------------

  public async startReconciliationJob(options?: { forceLiveInstagram?: boolean; ids?: string[] }): Promise<BackgroundJob> {
    const job = this.createJob('RECONCILIATION', options);

    setTimeout(() => {
      this.runReconciliationWorker(job.id, options).catch((err) => {
        console.error(`[BackgroundJobService] Unhandled error in job #${job.id}:`, err);
        mockStore.updateJob(job.id, {
          status: 'FAILED',
          error: err?.message || 'Reconciliation failed',
          completed_at: new Date().toISOString(),
        });
      });
    }, 10);

    return job;
  }

  private async runReconciliationWorker(jobId: string, options?: { forceLiveInstagram?: boolean; ids?: string[] }): Promise<void> {
    if (this.isCancelled(jobId)) return;
    mockStore.updateJob(jobId, {
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      current_step: 'Inspecting Instagram media and database records...',
      message: 'Authoritative duplicate & publishing reconciliation in progress...',
    });

    const { reconciliationService } = await import('@/services/reconciliationService');
    const report = await reconciliationService.reconcileBatch({
      ids: options?.ids,
      forceLiveInstagram: options?.forceLiveInstagram ?? true,
    });

    mockStore.updateJob(jobId, {
      status: 'COMPLETED',
      total: report.total,
      processed: report.total,
      success_count: report.alreadyPublished + report.confirmedNotPublished,
      skipped_count: report.duplicates,
      failed_count: report.unknown,
      current_step: 'Completed',
      message: `Reconciliation complete: ${report.alreadyPublished} verified published, ${report.duplicates} duplicates, ${report.confirmedNotPublished} confirmed failed, ${report.unknown} unknown.`,
      result: report,
      completed_at: new Date().toISOString(),
    });
  }
}

export const backgroundJobService = new BackgroundJobService();
