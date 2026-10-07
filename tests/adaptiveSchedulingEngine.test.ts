import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adaptiveSchedulingEngine } from '../services/growth/adaptiveSchedulingEngine';
import { mockStore } from '../lib/mockStore';
import { growthStore } from '../lib/growthStore';
import { confessionService } from '../services/confessionService';
import { Confession } from '../types';

describe('AdaptiveSchedulingEngine - Canonical Scheduling Authority', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Hard Active Hours Enforcement (09:00 - 22:00 Asia/Kolkata)
  // ---------------------------------------------------------------------------
  describe('Hard Active Hours Enforcement', () => {
    const settings = {
      ...mockStore.getSettings(),
      timezone: 'Asia/Kolkata',
      auto_publish_start_hour: 9,
      auto_publish_end_hour: 22,
    };

    it('Case 1: Candidate at 22:32 IST must rollover to next day 09:00 IST', () => {
      // 2026-10-07 17:02:00 UTC = 2026-10-07 22:32:00 IST
      const candidateDate = new Date('2026-10-07T17:02:00.000Z');
      const result = adaptiveSchedulingEngine.alignToActiveHours(candidateDate, settings);

      expect(result.wasRolledOver).toBe(true);
      expect(result.reasonType).toBe('ACTIVE_WINDOW_ROLLOVER');

      // 2026-10-08 09:00:00 IST = 2026-10-08 03:30:00 UTC
      expect(result.alignedDate.toISOString()).toBe('2026-10-08T03:30:00.000Z');
    });

    it('Case 2: Candidate at 22:30 IST must rollover to next day 09:00 IST', () => {
      // 2026-10-07 17:00:00 UTC = 2026-10-07 22:30:00 IST
      const candidateDate = new Date('2026-10-07T17:00:00.000Z');
      const result = adaptiveSchedulingEngine.alignToActiveHours(candidateDate, settings);

      expect(result.wasRolledOver).toBe(true);
      expect(result.reasonType).toBe('ACTIVE_WINDOW_ROLLOVER');
      expect(result.alignedDate.toISOString()).toBe('2026-10-08T03:30:00.000Z');
    });

    it('Case 3: Candidate at 02:00 IST (overnight) must roll to today 09:00 IST', () => {
      // 2026-10-07 20:30:00 UTC = 2026-10-08 02:00:00 IST
      const candidateDate = new Date('2026-10-07T20:30:00.000Z');
      const result = adaptiveSchedulingEngine.alignToActiveHours(candidateDate, settings);

      expect(result.wasRolledOver).toBe(true);
      expect(result.reasonType).toBe('ACTIVE_WINDOW_ROLLOVER');

      // Today 09:00 IST (2026-10-08 09:00:00 IST = 2026-10-08 03:30:00 UTC)
      expect(result.alignedDate.toISOString()).toBe('2026-10-08T03:30:00.000Z');
    });

    it('Case 4: Candidate at 11:15 IST (within active window) must be preserved exactly', () => {
      // 2026-10-07 05:45:00 UTC = 2026-10-07 11:15:00 IST
      const candidateDate = new Date('2026-10-07T05:45:00.000Z');
      const result = adaptiveSchedulingEngine.alignToActiveHours(candidateDate, settings);

      expect(result.wasRolledOver).toBe(false);
      expect(result.reasonType).toBe('NORMAL_CADENCE');
      expect(result.alignedDate.toISOString()).toBe('2026-10-07T05:45:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: N=0 Evidence Handling & Zero Fake Learning
  // ---------------------------------------------------------------------------
  describe('Zero Fake Learning When Sample Size Insufficient', () => {
    it('should strictly return BASELINE with confidence 0 when N=0 tracked posts', async () => {
      vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);
      vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue([]);
      vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([]);
      vi.spyOn(mockStore, 'getSettings').mockReturnValue({
        ...mockStore.getSettings(),
        scheduling_strategy_mode: 'AUTO',
        random_gap_enabled: true,
      });

      const strategy = await adaptiveSchedulingEngine.getCurrentSchedulingStrategy();

      expect(strategy.source).toBe('BASELINE');
      expect(strategy.confidence).toBe(0);
      expect(strategy.sample_size).toBe(0);
      expect(strategy.strategy_name).toBe('BASELINE_EXPLORATION');
      expect(strategy.is_learned).toBe(false);
      expect(strategy.reason).toContain('Baseline exploration');
    });

    it('should strictly return CONFIGURED when administrator explicitly selects MANUAL mode', async () => {
      vi.spyOn(mockStore, 'getSettings').mockReturnValue({
        ...mockStore.getSettings(),
        scheduling_strategy_mode: 'MANUAL',
        manual_fixed_gap_minutes: 45,
        anti_bot_jitter_minutes: 0,
      });

      const strategy = await adaptiveSchedulingEngine.getCurrentSchedulingStrategy();

      expect(strategy.source).toBe('CONFIGURED');
      expect(strategy.is_learned).toBe(false);
      expect(strategy.gap_range.min).toBe(45);
      expect(strategy.gap_range.max).toBe(45);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Machine-Readable Provenance Tracking
  // ---------------------------------------------------------------------------
  describe('Provenance Generation and Persistence', () => {
    it('should attach complete machine-readable provenance when scheduling a candidate', async () => {
      const mockConfession: Confession = {
        id: 'test-prov-1',
        google_sheet_row: 10,
        google_sheet_id: 'sheet',
        google_sheet_name: 'Sheet1',
        name: 'Anonymous',
        original_text: 'Test confession provenance text',
        cleaned_text: 'Test confession provenance text',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'APPROVED',
        moderation_status: 'SAFE',
        moderation_reason: null,
        ai_processed: true,
        template_id: 't-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: null,
        hashtags: [],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(mockStore, 'getConfessions').mockReturnValue([mockConfession]);
      vi.spyOn(mockStore, 'getConfessionById').mockReturnValue(mockConfession);
      const updateSpy = vi.spyOn(confessionService, 'updateConfession').mockImplementation(async (id, updates) => {
        Object.assign(mockConfession, updates);
        return mockConfession;
      });

      const scheduled = await adaptiveSchedulingEngine.scheduleNextCandidate(mockConfession);

      expect(scheduled.status).toBe('SCHEDULED');
      expect(scheduled.scheduled_at).toBeTruthy();
      expect(scheduled.scheduling_provenance).toBeDefined();

      const prov = scheduled.scheduling_provenance!;
      expect(prov.evaluated_at).toBeTruthy();
      expect(prov.strategy_source).toBeTruthy();
      expect(prov.gap_minutes).toBeGreaterThan(0);
      expect(prov.reason_type).toBeTruthy();
      expect(prov.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: Invariant Verification and Queue Repair
  // ---------------------------------------------------------------------------
  describe('Invariant Verification & repairQueue', () => {
    it('should detect stale items in the past and repair them sequentially into active hours', async () => {
      const pastMs = Date.now() - 3600000; // 1 hour ago
      const mockConfessions: Confession[] = [
        {
          id: 'stale-1',
          google_sheet_row: 2,
          google_sheet_id: 'sheet',
          google_sheet_name: 'Sheet1',
          name: 'Anonymous',
          original_text: 'Stale post 1',
          cleaned_text: 'Stale post 1',
          display_name: 'Anonymous',
          is_anonymous: true,
          status: 'SCHEDULED',
          moderation_status: 'SAFE',
          moderation_reason: null,
          ai_processed: true,
          template_id: 't-1',
          generated_image_url: null,
          generated_image_path: null,
          caption: null,
          hashtags: [],
          scheduled_at: new Date(pastMs - 1800000).toISOString(), // 1.5h ago
          published_at: null,
          instagram_media_id: null,
          instagram_permalink: null,
          retry_count: 0,
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'stale-2',
          google_sheet_row: 3,
          google_sheet_id: 'sheet',
          google_sheet_name: 'Sheet1',
          name: 'Anonymous',
          original_text: 'Stale post 2',
          cleaned_text: 'Stale post 2',
          display_name: 'Anonymous',
          is_anonymous: true,
          status: 'SCHEDULED',
          moderation_status: 'SAFE',
          moderation_reason: null,
          ai_processed: true,
          template_id: 't-1',
          generated_image_url: null,
          generated_image_path: null,
          caption: null,
          hashtags: [],
          scheduled_at: new Date(pastMs).toISOString(), // 1h ago
          published_at: null,
          instagram_media_id: null,
          instagram_permalink: null,
          retry_count: 0,
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions);
      vi.spyOn(mockStore, 'updateConfession').mockImplementation((id, updates) => {
        const item = mockConfessions.find((c) => c.id === id);
        if (item) Object.assign(item, updates);
        return item || null;
      });

      const repairResult = await adaptiveSchedulingEngine.repairQueue();

      expect(repairResult.repairedCount).toBe(2);
      expect(repairResult.repairedConfessions.length).toBe(2);

      const post1 = mockConfessions.find((c) => c.id === 'stale-1')!;
      const post2 = mockConfessions.find((c) => c.id === 'stale-2')!;

      // Both must be scheduled in the future
      expect(new Date(post1.scheduled_at!).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(post2.scheduled_at!).getTime()).toBeGreaterThan(Date.now());

      // FIFO ordering preserved
      expect(new Date(post1.scheduled_at!).getTime()).toBeLessThan(new Date(post2.scheduled_at!).getTime());

      // Validated pending schedules should now report 0 invalid
      const report = await adaptiveSchedulingEngine.validateAllPendingSchedules();
      expect(report.invalid).toBe(0);
      expect(report.outside_active_hours).toBe(0);
    });
  });
});
