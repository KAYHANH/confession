import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confessionService } from '../services/confessionService';
import { mockStore } from '../lib/mockStore';
import { growthStore } from '../lib/growthStore';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { Confession } from '../types';

describe('ConfessionFlow Authoritative Counting & Status Clarity Engine', () => {
  beforeEach(() => {
    mockStore.resetToDefaults();
  });

  describe('1. Authoritative Counting Engine & Mutually Exclusive Partitioning', () => {
    it('partitions all records in database such that exclusiveSum strictly equals totalRecords (100% parity)', async () => {
      const counts = await confessionService.getAuthoritativeCounts();
      const all = mockStore.getConfessions();

      expect(counts.totalRecords).toBe(all.length);
      expect(counts.exclusiveSum).toBe(all.length);
      expect(counts.isReconciled).toBe(true);

      const part = counts.exclusivePartitions;
      const computedSum =
        part.needsReview +
        part.approvedUnscheduled +
        part.scheduled +
        part.publishing +
        part.published +
        part.confirmedFailed +
        part.unknown +
        part.duplicate +
        part.lowValue +
        part.deleted;

      expect(computedSum).toBe(counts.totalRecords);
    });

    it('returns structured diagnostics items explaining every status, query filter, and category', async () => {
      const counts = await confessionService.getAuthoritativeCounts();

      expect(counts.diagnostics).toBeDefined();
      expect(counts.diagnostics.length).toBeGreaterThanOrEqual(10);

      const exclusiveItems = counts.diagnostics.filter((d) => d.type === 'MUTUALLY_EXCLUSIVE_PARTITION');
      const pipelineItems = counts.diagnostics.filter((d) => d.type === 'OPERATIONAL_PIPELINE');
      const overlappingItems = counts.diagnostics.filter((d) => d.type === 'OVERLAPPING_METRIC');

      expect(exclusiveItems.length).toBe(10);
      expect(pipelineItems.length).toBeGreaterThanOrEqual(2);
      expect(overlappingItems.length).toBeGreaterThanOrEqual(3);

      for (const item of counts.diagnostics) {
        expect(item.name).toBeTruthy();
        expect(item.key).toBeTruthy();
        expect(item.definition).toBeTruthy();
        expect(item.queryFilter).toBeTruthy();
        expect(typeof item.count).toBe('number');
      }
    });
  });

  describe('2. Resolution of the 3 Core Counter Discrepancies', () => {
    it('Discrepancy 1: active pipeline equals queued + scheduled and strictly excludes quarantined duplicates', async () => {
      const counts = await confessionService.getAuthoritativeCounts();

      // In the legacy code, active was computed as: queue + scheduled + duplicates
      // E.g. 24 + 212 + 4 = 240
      // In the authoritative engine:
      // active = queued + scheduled + publishing (24 + 212 = 236)
      expect(counts.pipeline.active).toBe(
        counts.pipeline.queued + counts.pipeline.scheduled + counts.exclusivePartitions.publishing
      );

      // Duplicates are quarantined terminal dead-ends, not active work
      expect(counts.exclusivePartitions.duplicate).toBeGreaterThanOrEqual(0);
      expect(counts.pipeline.active).not.toContain(counts.exclusivePartitions.duplicate);
    });

    it('Discrepancy 2: Upload Queue holds unscheduled submissions (scheduled_at === null), while Scheduled holds slot-assigned records', async () => {
      const counts = await confessionService.getAuthoritativeCounts();

      // Fetch confessions on queue tab vs scheduled tab
      const queueRes = await confessionService.getConfessions({ tab: 'queue' });
      const scheduledRes = await confessionService.getConfessions({ tab: 'scheduled' });

      // All items in queue are unscheduled (scheduled_at is null or not scheduled)
      for (const c of queueRes.confessions) {
        expect(c.status).not.toBe('SCHEDULED');
        expect(c.scheduled_at).toBeNull();
      }

      // All items in scheduled tab have a scheduled status or valid slot
      for (const c of scheduledRes.confessions) {
        expect(c.status).toBe('SCHEDULED');
      }

      expect(counts.pipeline.queued).toBe(queueRes.total);
      expect(counts.pipeline.scheduled).toBe(scheduledRes.total);
    });

    it('Discrepancy 3: distinguishes live feed absence (confirmedNotPublished) from publishing failures (confirmedFailed)', async () => {
      const counts = await confessionService.getAuthoritativeCounts();

      // confirmedFailed must be in exclusive partitions
      expect(typeof counts.exclusivePartitions.confirmedFailed).toBe('number');

      // confirmedNotPublished is an overlapping audit metric from Instagram reconciliation
      expect(typeof counts.overlappingMetrics.confirmedNotPublished).toBe('number');

      // Safe to retry must strictly enforce approval and attempt limits
      expect(counts.overlappingMetrics.safeToRetry).toBeLessThanOrEqual(
        counts.exclusivePartitions.confirmedFailed + counts.overlappingMetrics.confirmedNotPublished
      );
    });
  });

  describe('3. Overlapping Metrics vs Exclusive Partitions', () => {
    it('correctly tracks totalQualityFlagged across all lifecycle states without inflating exclusive lowValue partition', async () => {
      const counts = await confessionService.getAuthoritativeCounts();
      const all = mockStore.getConfessions();

      const totalLowQualityInStore = all.filter((c) => c.quality_status === 'LOW_VALUE').length;
      expect(counts.overlappingMetrics.totalQualityFlagged).toBe(totalLowQualityInStore);

      // Exclusive partition for lowValue only counts un-deleted, un-published backlog records
      expect(counts.exclusivePartitions.lowValue).toBeLessThanOrEqual(counts.overlappingMetrics.totalQualityFlagged);

      // Total records parity must still hold
      expect(counts.exclusiveSum).toBe(counts.totalRecords);
    });
  });

  describe('4. Safe to Retry & Publishing Idempotency Guardrails', () => {
    it('strictly forbids retrying ambiguous (UNKNOWN) records', async () => {
      const mockConfession: Confession = {
        id: 'test-unknown-retry',
        name: 'Anon',
        original_text: 'Unknown timeout confession',
        cleaned_text: 'Unknown timeout confession',
        status: 'UNKNOWN',
        reconciliation_status: 'UNKNOWN',
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockStore.addConfession(mockConfession);

      expect(confessionService.isSafeToRetry(mockConfession)).toBe(false);
    });

    it('strictly forbids retrying already published records', async () => {
      const mockConfession: Confession = {
        id: 'test-published-retry',
        name: 'Anon',
        original_text: 'Already published post',
        cleaned_text: 'Already published post',
        status: 'PUBLISHED',
        instagram_media_id: 'media_xyz',
        reconciliation_status: 'ALREADY_PUBLISHED',
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockStore.addConfession(mockConfession);

      expect(confessionService.isSafeToRetry(mockConfession)).toBe(false);
    });

    it('strictly forbids retrying deleted or low-value records', async () => {
      const deletedConfession: Confession = {
        id: 'test-deleted-retry',
        name: 'Anon',
        original_text: 'Deleted post',
        cleaned_text: 'Deleted post',
        status: 'DELETED',
        deleted_at: new Date().toISOString(),
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const lowValueConfession: Confession = {
        id: 'test-lowvalue-retry',
        name: 'Anon',
        original_text: 'asdf',
        cleaned_text: 'asdf',
        status: 'FAILED',
        quality_status: 'LOW_VALUE',
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(confessionService.isSafeToRetry(deletedConfession)).toBe(false);
      expect(confessionService.isSafeToRetry(lowValueConfession)).toBe(false);
    });

    it('only marks a record as safeToRetry if verified absent from Instagram, approved/failed, and retry_count < 3', async () => {
      const validRetryCandidate: Confession = {
        id: 'test-valid-retry',
        name: 'Anon',
        original_text: 'Valid retry confession',
        cleaned_text: 'Valid retry confession',
        status: 'FAILED',
        reconciliation_status: 'CONFIRMED_NOT_PUBLISHED',
        moderation_status: 'LOW',
        retry_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(confessionService.isSafeToRetry(validRetryCandidate)).toBe(true);

      // If retry_count reaches 3, it should become false
      validRetryCandidate.retry_count = 3;
      expect(confessionService.isSafeToRetry(validRetryCandidate)).toBe(false);
    });
  });

  describe('5. Growth Cadence Intelligence Provenance & Evidence Gate', () => {
    it('sets supportState to INSUFFICIENT_DATA and provenance to BASELINE when snapshot evidence N < 5', async () => {
      cadenceAnalyzer.invalidateCache();
      mockStore.updateSettings({
        scheduling_strategy_mode: 'AUTO',
        auto_publish_interval_minutes: 60,
      });

      // Simulate insufficient snapshot history (empty array)
      vi.spyOn(growthStore, 'getSnapshots').mockResolvedValueOnce([]);

      const recommendation = await cadenceAnalyzer.getCadenceRecommendation(true);

      expect(recommendation.evidenceCount).toBe(0);
      expect(recommendation.supportState).toBe('INSUFFICIENT_DATA');
      expect(recommendation.provenance).toBe('BASELINE');
      expect(recommendation.confidence).toBe('LOW');
      expect(recommendation.timeWindow).toBe('No snapshot history');
    });

    it('sets provenance to CONFIGURED when strategy mode is MANUAL', async () => {
      cadenceAnalyzer.invalidateCache();
      mockStore.updateSettings({
        scheduling_strategy_mode: 'MANUAL',
        manual_fixed_gap_minutes: 90,
      });

      const recommendation = await cadenceAnalyzer.getCadenceRecommendation(true);

      expect(recommendation.provenance).toBe('CONFIGURED');
      expect(recommendation.recommendedGapRangeMinutes.min).toBe(90);
      expect(recommendation.recommendedGapRangeMinutes.max).toBe(90);
      expect(recommendation.timeWindow).toContain('Configured Active Window');
    });

    it('sets provenance to LEARNED with valid timeWindow when evidence sample size N >= 5', async () => {
      cadenceAnalyzer.invalidateCache();
      mockStore.updateSettings({
        scheduling_strategy_mode: 'AUTO',
        auto_publish_interval_minutes: 60,
      });

      const recommendation = await cadenceAnalyzer.getCadenceRecommendation(true);

      expect(recommendation.evidenceCount).toBeGreaterThanOrEqual(5);
      expect(recommendation.provenance).toBe('LEARNED');
      expect(recommendation.timeWindow).toBe('Last 30 days');
    });
  });
});
