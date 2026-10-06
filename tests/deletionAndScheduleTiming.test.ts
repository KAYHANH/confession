import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confessionService, ALLOWED_TRANSITIONS } from '../services/confessionService';
import { schedulingService } from '../services/schedulingService';
import { mockStore } from '../lib/mockStore';
import { growthStore } from '../lib/growthStore';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { googleSheetsService } from '../services/googleSheetsService';
import { Confession } from '../types';

describe('Deleted Section & Schedule Recalculation Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockStore.setConfessions([]);
    mockStore.setDeletedRowNumbers([]);
    cadenceAnalyzer.invalidateCache();
    schedulingService.resetState();
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue([]);
    vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([]);
    vi.spyOn(googleSheetsService, 'updateRowStatus').mockResolvedValue(true);
    mockStore.updateSettings({
      auto_publish_enabled: true,
      auto_publish_interval_minutes: 60,
      auto_publish_start_hour: 9,
      auto_publish_end_hour: 22,
      max_posts_per_day: 10,
      random_gap_enabled: false,
      enable_growth_intelligence: false,
      scheduling_strategy_mode: 'AUTO',
    });
  });

  describe('Status Machine Rules for DELETED', () => {
    it('allows transition to DELETED from non-terminal states', () => {
      expect(confessionService.isValidTransition('READY_FOR_REVIEW', 'DELETED')).toBe(true);
      expect(confessionService.isValidTransition('APPROVED', 'DELETED')).toBe(true);
      expect(confessionService.isValidTransition('SCHEDULED', 'DELETED')).toBe(true);
      expect(confessionService.isValidTransition('REJECTED', 'DELETED')).toBe(true);
      expect(confessionService.isValidTransition('FAILED', 'DELETED')).toBe(true);
    });

    it('prohibits transitioning already PUBLISHED confessions to other statuses', () => {
      expect(confessionService.isValidTransition('PUBLISHED', 'DELETED')).toBe(false);
      expect(confessionService.isValidTransition('PUBLISHED', 'APPROVED')).toBe(false);
    });

    it('allows restoring from DELETED to APPROVED or READY_FOR_REVIEW', () => {
      expect(confessionService.isValidTransition('DELETED', 'APPROVED')).toBe(true);
      expect(confessionService.isValidTransition('DELETED', 'READY_FOR_REVIEW')).toBe(true);
      expect(confessionService.isValidTransition('DELETED', 'PUBLISHED')).toBe(false);
    });
  });

  describe('Soft Deletion and Queue Timing Updates', () => {
    it('marks confession as DELETED, clears scheduled_at, and saves deletedRowNumbers', async () => {
      const conf1 = mockStore.addConfession({
        name: 'Alice',
        display_name: 'Alice',
        original_text: 'Secret #1',
        cleaned_text: 'Secret #1',
        google_sheet_row: 101,
        google_sheet_id: 'sheet_1',
        status: 'APPROVED',
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
      });

      const deleted = await confessionService.deleteConfession(conf1.id, false);
      expect(deleted).toBe(true);

      const updated = mockStore.getConfessionById(conf1.id);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('DELETED');
      expect(updated?.deleted_at).toBeDefined();
      expect(updated?.scheduled_at).toBeNull();
      expect(mockStore.getDeletedRowNumbers().has(101)).toBe(true);
    });

    it('recalculates and updates other confession timings when one is deleted', async () => {
      const baseTime = Date.now();
      const conf1 = mockStore.addConfession({
        id: 'c1',
        name: 'User 1',
        display_name: 'User 1',
        original_text: 'Confession 1',
        cleaned_text: 'Confession 1',
        google_sheet_row: 10,
        google_sheet_id: 'sheet_1',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date(baseTime - 30000).toISOString(),
      });

      const conf2 = mockStore.addConfession({
        id: 'c2',
        name: 'User 2',
        display_name: 'User 2',
        original_text: 'Confession 2',
        cleaned_text: 'Confession 2',
        google_sheet_row: 11,
        google_sheet_id: 'sheet_1',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date(baseTime - 20000).toISOString(),
      });

      const conf3 = mockStore.addConfession({
        id: 'c3',
        name: 'User 3',
        display_name: 'User 3',
        original_text: 'Confession 3',
        cleaned_text: 'Confession 3',
        google_sheet_row: 12,
        google_sheet_id: 'sheet_1',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date(baseTime - 10000).toISOString(),
      });

      // Generate initial schedule
      const sched1 = await schedulingService.generateFutureSchedule({ forceRecalculate: true });
      expect(sched1.items.length).toBe(3);

      const conf2OriginalTime = mockStore.getConfessionById(conf2.id)?.scheduled_at;
      const conf3OriginalTime = mockStore.getConfessionById(conf3.id)?.scheduled_at;
      expect(conf2OriginalTime).toBeDefined();
      expect(conf3OriginalTime).toBeDefined();

      // Delete conf1 (the first in queue)
      await confessionService.deleteConfession(conf1.id, false);

      // Now conf2 should be promoted to slot 1 and have conf1's earlier slot time
      const conf2Updated = mockStore.getConfessionById(conf2.id);
      const conf3Updated = mockStore.getConfessionById(conf3.id);

      expect(conf2Updated?.scheduled_at).toBeDefined();
      expect(conf3Updated?.scheduled_at).toBeDefined();
      // conf2 was shifted forward to become the immediate next post
      expect(new Date(conf2Updated!.scheduled_at!).getTime()).toBeLessThanOrEqual(new Date(conf2OriginalTime!).getTime());
    });
  });

  describe('Protection from Google Sheets Sync Re-Import', () => {
    it('strictly skips deleted rows during Google Sheet synchronization', async () => {
      const conf = mockStore.addConfession({
        name: 'Bob',
        display_name: 'Bob',
        original_text: 'I hid the cookies',
        cleaned_text: 'I hid the cookies',
        google_sheet_row: 42,
        google_sheet_id: 'sheet_demo',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
      });

      // Delete it
      await confessionService.deleteConfession(conf.id, false);
      expect(mockStore.getDeletedRowNumbers().has(42)).toBe(true);

      // Mock sheet returning row 42 and row 43
      vi.spyOn(googleSheetsService, 'fetchRows').mockResolvedValue([
        {
          rowNumber: 42,
          timestamp: new Date().toISOString(),
          name: 'Bob',
          confession: 'I hid the cookies',
          status: 'APPROVED',
          isAnonymous: false,
        },
        {
          rowNumber: 43,
          timestamp: new Date().toISOString(),
          name: 'Charlie',
          confession: 'Brand new confession about my secret crush on the chemistry tutor from last semester.',
          status: 'READY_FOR_REVIEW',
          isAnonymous: false,
        },
      ]);

      const syncResult = await schedulingService.syncGoogleSheet();

      // Only row 43 should be imported as new confession, row 42 MUST be skipped
      expect(syncResult.imported).toBe(1);

      // Confession for row 42 should still be DELETED and NOT duplicated or revived
      const allRow42 = mockStore.getConfessions().filter((c) => c.google_sheet_row === 42);
      expect(allRow42.length).toBe(1);
      expect(allRow42[0].status).toBe('DELETED');

      // Row 43 was imported (and auto-approved as low risk)
      const row43 = mockStore.getConfessions().find((c) => c.google_sheet_row === 43);
      expect(row43).toBeDefined();
      expect(row43?.status).toBe('APPROVED');
    });

    it('strictly skips re-importing even if permanent delete removed the item from memory', async () => {
      const conf = mockStore.addConfession({
        name: 'Ghost',
        display_name: 'Ghost',
        original_text: 'Vanishing confession',
        cleaned_text: 'Vanishing confession',
        google_sheet_row: 99,
        google_sheet_id: 'sheet_demo',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
      });

      // Permanently delete
      await confessionService.deleteConfession(conf.id, true);
      expect(mockStore.getConfessionById(conf.id)).toBeUndefined();
      expect(mockStore.getDeletedRowNumbers().has(99)).toBe(true);

      // Mock sheet returning row 99
      vi.spyOn(googleSheetsService, 'fetchRows').mockResolvedValue([
        {
          rowNumber: 99,
          timestamp: new Date().toISOString(),
          name: 'Ghost',
          confession: 'Vanishing confession',
          status: 'APPROVED',
          isAnonymous: false,
        },
      ]);

      const syncResult = await schedulingService.syncGoogleSheet();
      expect(syncResult.imported).toBe(0);

      // Should still NOT exist in confessions
      const found = mockStore.getConfessions().find((c) => c.google_sheet_row === 99);
      expect(found).toBeUndefined();
    });
  });

  describe('Restoration and Bulk Operations', () => {
    it('restores confession back to APPROVED and recalculates schedule timing', async () => {
      const conf = mockStore.addConfession({
        name: 'David',
        display_name: 'David',
        original_text: 'I want to come back',
        cleaned_text: 'I want to come back',
        google_sheet_row: 77,
        google_sheet_id: 'sheet_demo',
        status: 'APPROVED',
        is_anonymous: false,
        moderation_status: 'LOW',
        created_at: new Date().toISOString(),
      });

      await confessionService.deleteConfession(conf.id, false);
      expect(mockStore.getConfessionById(conf.id)?.status).toBe('DELETED');
      expect(mockStore.getDeletedRowNumbers().has(77)).toBe(true);

      const restored = await confessionService.restoreConfession(conf.id);
      expect(restored).toBeDefined();
      expect(restored?.status).toBe('APPROVED');
      expect(restored?.deleted_at).toBeNull();
      expect(mockStore.getDeletedRowNumbers().has(77)).toBe(false);

      // Should be scheduled in future timings
      expect(restored?.scheduled_at).toBeDefined();
    });

    it('supports bulk deletion and bulk restoration', async () => {
      const c1 = mockStore.addConfession({
        id: 'bulk-1',
        name: 'Bulk 1',
        display_name: 'Bulk 1',
        original_text: 'Bulk 1',
        cleaned_text: 'Bulk 1',
        google_sheet_row: 201,
        status: 'APPROVED',
        created_at: new Date().toISOString(),
      });
      const c2 = mockStore.addConfession({
        id: 'bulk-2',
        name: 'Bulk 2',
        display_name: 'Bulk 2',
        original_text: 'Bulk 2',
        cleaned_text: 'Bulk 2',
        google_sheet_row: 202,
        status: 'APPROVED',
        created_at: new Date().toISOString(),
      });

      // Bulk soft delete
      const deletedResult = await confessionService.bulkDelete([c1.id, c2.id], false);
      expect(deletedResult.deleted.length).toBe(2);
      expect(mockStore.getConfessionById(c1.id)?.status).toBe('DELETED');
      expect(mockStore.getConfessionById(c2.id)?.status).toBe('DELETED');

      // Bulk restore
      const restoredResult = await confessionService.bulkRestore([c1.id, c2.id]);
      expect(restoredResult.restored.length).toBe(2);
      expect(['APPROVED', 'SCHEDULED']).toContain(mockStore.getConfessionById(c1.id)?.status);
      expect(['APPROVED', 'SCHEDULED']).toContain(mockStore.getConfessionById(c2.id)?.status);
    });
  });
});
