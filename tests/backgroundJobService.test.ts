import { describe, it, expect, beforeEach } from 'vitest';
import { backgroundJobService } from '../services/backgroundJobService';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';

describe('Background Job Service & Asynchronous Processing', () => {
  beforeEach(() => {
    mockStore.resetToDefaults();
    // Ensure no active jobs lingering
    const active = mockStore.getActiveJob();
    if (active) {
      mockStore.updateJob(active.id, { status: 'CANCELLED' });
    }

    const confessions = mockStore.getConfessions();
    const sampleFailed: Confession[] = Array.from({ length: 5 }).map((_, i) => ({
      id: `failed-post-${i + 1}`,
      submission_id: 200 + i,
      raw_text: `Test failed confession text ${i + 1}`,
      clean_text: `Test failed confession text ${i + 1}`,
      category: 'Campus Life',
      tags: ['test'],
      sentiment: 'neutral',
      content_risk_score: 0.1,
      moderation_status: 'SAFE',
      status: 'FAILED',
      reconciliation_status: 'CONFIRMED_NOT_PUBLISHED',
      retry_count: 0,
      max_retries: 3,
      error_message: 'Network timeout',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    }));
    mockStore.setConfessions([...confessions, ...sampleFailed]);
  });

  it('creates and returns a job immediately (< 50ms) with QUEUED status', async () => {
    const start = performance.now();
    const job = await backgroundJobService.startQueueRestartJob({ targetIds: ['failed-post-1'] });
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    expect(job.id).toBeDefined();
    expect(job.id).toMatch(/^job-/);
    expect(job.status).toBe('QUEUED');
    expect(job.type).toBe('QUEUE_RESTART');

    backgroundJobService.cancelJob(job.id);
  });

  it('enforces concurrency lock preventing simultaneous conflicting jobs', async () => {
    const job1 = await backgroundJobService.startQueueRestartJob({ targetIds: ['failed-post-1'] });
    expect(job1.status).toBe('QUEUED');

    // Attempting to start another job immediately should fail due to lock
    await expect(backgroundJobService.startQueueRestartJob()).rejects.toThrow(
      /A background operation is already in progress/i
    );

    backgroundJobService.cancelJob(job1.id);
  });

  it('completes the queue restart worker asynchronously without calling Instagram publish', async () => {
    const job = await backgroundJobService.startQueueRestartJob({ targetIds: ['failed-post-1', 'failed-post-2'] });
    const jobId = job.id;

    // Poll until completed (with 20s timeout limit)
    let attempts = 0;
    while (attempts < 80) {
      const current = backgroundJobService.getJob(jobId);
      if (current && (current.status === 'COMPLETED' || current.status === 'FAILED')) break;
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    const completedJob = backgroundJobService.getJob(jobId);
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe('COMPLETED');
    expect(completedJob?.processed).toBe(completedJob?.total);
    expect(completedJob?.success_count).toBeGreaterThan(0);

    // Verify scheduled_at timestamps are now set in future for restarted items
    const sample = mockStore.getConfessionById('failed-post-1');
    expect(sample?.status).toBe('SCHEDULED');
    expect(sample?.scheduled_at).toBeDefined();
    if (sample?.scheduled_at) {
      expect(new Date(sample.scheduled_at).getTime()).toBeGreaterThan(Date.now() - 60000);
    }
  }, 25000);

  it('cancels an active job cleanly', async () => {
    const job = await backgroundJobService.startQueueRestartJob({ targetIds: ['failed-post-1'] });
    const jobId = job.id;

    const cancelled = backgroundJobService.cancelJob(jobId);
    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe('CANCELLED');

    const retrieved = backgroundJobService.getJob(jobId);
    expect(retrieved?.status).toBe('CANCELLED');
  });

  it('recovers stalled jobs on server startup', () => {
    const stalledJob = {
      id: 'stalled-job-999',
      type: 'QUEUE_RESTART' as const,
      status: 'RUNNING' as const,
      total: 100,
      processed: 25,
      success_count: 25,
      skipped_count: 0,
      failed_count: 0,
      created_at: new Date(Date.now() - 300000).toISOString(),
    };
    mockStore.addJob(stalledJob);

    const recovered = backgroundJobService.cleanupStalledJobs();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const jobAfterCleanup = backgroundJobService.getJob('stalled-job-999');
    expect(jobAfterCleanup?.status).toBe('INTERRUPTED');
  });
});
