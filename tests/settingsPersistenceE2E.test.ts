import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsService } from '../services/settingsService';
import { mockStore } from '../lib/mockStore';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { adaptiveSchedulingEngine } from '../services/growth/adaptiveSchedulingEngine';
import { growthMetricsService } from '../services/growth/growthMetricsService';

describe('ConfessionFlow - Authoritative Settings Persistence & Real-time Synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cadenceAnalyzer.invalidateCache();
  });

  // --------------------------------------------------------------------------
  // Test 1: Server-Side Validation
  // --------------------------------------------------------------------------
  describe('Server-side Validation', () => {
    it('rejects invalid timezone', () => {
      const result = settingsService.validateSettings({ timezone: 'Invalid/City' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Invalid IANA timezone');
    });

    it('rejects invalid active hours (start > end)', () => {
      const result = settingsService.validateSettings({
        auto_publish_start_hour: 22,
        auto_publish_end_hour: 9,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('start hour (22:00) cannot be after end hour (9:00)'))).toBe(true);
    });

    it('allows 24/7 operating hours (start 0, end 24)', () => {
      const result = settingsService.validateSettings({
        auto_publish_start_hour: 0,
        auto_publish_end_hour: 24,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('rejects invalid gap spacing (min_gap > max_gap)', () => {
      const result = settingsService.validateSettings({
        min_gap_minutes: 90,
        max_gap_minutes: 45,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('min_gap_minutes (90m) cannot exceed max_gap_minutes (45m)'))).toBe(true);
    });

    it('rejects invalid daily volume guardrails (min_daily > max_daily)', () => {
      const result = settingsService.validateSettings({
        min_daily_posts: 8,
        max_daily_posts: 4,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('min_daily_posts (8) cannot exceed max_daily_posts (4)'))).toBe(true);
    });

    it('rejects target_daily_posts outside [min_daily, max_daily]', () => {
      const result = settingsService.validateSettings({
        min_daily_posts: 2,
        max_daily_posts: 6,
        target_daily_posts: 10,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Fallback target_daily_posts (10) must be within [2, 6]'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: Database Persistence & Versioning (Single Source of Truth)
  // --------------------------------------------------------------------------
  describe('Database Persistence & Versioning', () => {
    it('persists settings to database/store and increments version atomically', async () => {
      const initial = await settingsService.getSettings();
      const initialVersion = initial.settings_version || 1;

      const updateResult = await settingsService.updateSettings({
        brand_name: 'Campus Truths E2E',
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.version).toBe(initialVersion + 1);
      expect(updateResult.settings.brand_name).toBe('Campus Truths E2E');
      expect(updateResult.settings.settings_version).toBe(initialVersion + 1);
      expect(updateResult.updatedAt).toBeDefined();

      // Verified by reading back from store directly
      const directFromStore = mockStore.getSettings();
      expect(directFromStore.brand_name).toBe('Campus Truths E2E');
      expect(directFromStore.settings_version).toBe(initialVersion + 1);
    });

    it('detects concurrent session conflict when expectedVersion is stale', async () => {
      const current = await settingsService.getSettings();
      const currentVersion = current.settings_version || 1;

      // Expect version 999 when current version is lower
      await expect(
        settingsService.updateSettings(
          { brand_name: 'Conflict Test' },
          { expectedVersion: currentVersion + 5 }
        )
      ).rejects.toThrow(/Conflict: settings were updated in another session/);
    });

    it('logs structured audit entry for every mutated field', async () => {
      await settingsService.updateSettings({
        brand_name: 'Audit Brand Test',
      });

      const logs = mockStore.getLogs();
      const log = logs.find((l) => l.action === 'SETTINGS_UPDATED' && l.entity_id === 'brand_name');
      expect(log).toBeDefined();
      expect(log?.metadata.new_value).toBe('Audit Brand Test');
      expect(log?.metadata.author).toBe('admin');
    });
  });

  // --------------------------------------------------------------------------
  // Test 3: Downstream Scheduling Synchronization (10:00–20:00 Exact Test)
  // --------------------------------------------------------------------------
  describe('Downstream Scheduling Synchronization (10:00–20:00 Test)', () => {
    it('immediately reflects new active hours in database, scheduler, and recalculates future queue', async () => {
      // 1. Mutate active hours
      const result = await settingsService.updateSettings({
        auto_publish_start_hour: 10,
        auto_publish_end_hour: 20,
      });

      expect(result.success).toBe(true);
      expect(result.settings.auto_publish_start_hour).toBe(10);
      expect(result.settings.auto_publish_end_hour).toBe(20);
      expect(result.changedFields).toContain('auto_publish_start_hour');
      expect(result.changedFields).toContain('auto_publish_end_hour');

      // 2. Database verification
      const storeSettings = mockStore.getSettings();
      expect(storeSettings.auto_publish_start_hour).toBe(10);
      expect(storeSettings.auto_publish_end_hour).toBe(20);

      // 3. Scheduler verification: AdaptiveSchedulingEngine aligns to the updated 10:00–20:00 window
      const outsideSlot = new Date('2026-10-15T09:00:00+05:30'); // 09:00 is outside 10:00–20:00
      const aligned = adaptiveSchedulingEngine.alignToActiveHours(outsideSlot, storeSettings);
      expect(aligned.wasRolledOver).toBe(true);

      const parts = adaptiveSchedulingEngine.getZonedParts(aligned.alignedDate, storeSettings.timezone || 'Asia/Kolkata');
      expect(parts.hour).toBe(10);
      expect(parts.minute).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: Max Daily Posts Constraint (6 -> 3 Test)
  // --------------------------------------------------------------------------
  describe('Growth Intelligence Hard Limit (MAX_DAILY_POSTS 6 -> 3 Test)', () => {
    it('strictly clamps Growth Intelligence recommendations to MAX_DAILY_POSTS = 3', async () => {
      // Set hard limits: min 1, target 2, max 3
      await settingsService.updateSettings({
        min_daily_posts: 1,
        target_daily_posts: 2,
        max_daily_posts: 3,
        scheduling_strategy_mode: 'AUTO',
      });

      // Mock empirical evidence suggesting optimal frequency is 8 posts/day
      vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
        buckets: [],
        optimal_posts_per_day: 8,
        saturation_knee_point: 8,
        degradation_detected: false,
        confidence: 0.95,
        sample_size: 100,
        days_of_data: 14,
        summary: 'Optimal frequency is 8 posts/day.',
      });

      cadenceAnalyzer.invalidateCache();
      const plan = await cadenceAnalyzer.generateDailyGrowthPlan();

      expect(plan.recommended_posts).toBe(8); // AI recommendation
      expect(plan.effective_daily_posts).toBe(3); // Hard clamped to max_daily_posts
      expect(plan.max_allowed_posts).toBe(3);
      expect(plan.authority_source).toBe('SETTINGS_HARD_LIMIT');
      expect(plan.reason).toContain('clamped to 3 by hard settings limits [1-3]');
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Authority Mode Persistence (AUTO_GROWTH -> MANUAL Test)
  // --------------------------------------------------------------------------
  describe('Authority Mode Persistence (AUTO_GROWTH -> MANUAL Test)', () => {
    it('persists MANUAL mode and prevents Growth Intelligence from overriding configured quota', async () => {
      await settingsService.updateSettings({
        target_daily_posts: 4,
        min_daily_posts: 2,
        max_daily_posts: 6,
        scheduling_strategy_mode: 'MANUAL',
      });

      // Even with strong evidence for 5 posts/day
      vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
        buckets: [],
        optimal_posts_per_day: 5,
        saturation_knee_point: 5,
        degradation_detected: false,
        confidence: 0.99,
        sample_size: 150,
        days_of_data: 20,
        summary: 'Optimal frequency is 5 posts/day.',
      });

      cadenceAnalyzer.invalidateCache();
      const plan = await cadenceAnalyzer.generateDailyGrowthPlan();

      expect(plan.effective_daily_posts).toBe(4); // Strictly manual quota
      expect(plan.authority_source).toBe('ADMIN_OVERRIDE');
      expect(plan.reason).toContain('Admin override mode active. Using manual operational quota (4 posts/day)');
    });
  });

  // --------------------------------------------------------------------------
  // Test 6: Database Write Failure & Rollback
  // --------------------------------------------------------------------------
  describe('Database Write Verification & Error Handling', () => {
    it('throws error and does not mutate memory when mockStore save fails', async () => {
      const initial = await settingsService.getSettings();
      const initialBrand = initial.brand_name;

      vi.spyOn(mockStore, 'updateSettings').mockImplementation(() => {
        throw new Error('Disk IO failure: permission denied writing .mock_data.json');
      });

      await expect(
        settingsService.updateSettings({ brand_name: 'Failed Write Brand' })
      ).rejects.toThrow(/Disk IO failure/);

      // Verify original settings were untouched
      const after = await settingsService.getSettings();
      expect(after.brand_name).toBe(initialBrand);
    });
  });

  // --------------------------------------------------------------------------
  // Test 7: Payload Normalization & Canonical Key-Value Format
  // --------------------------------------------------------------------------
  describe('Payload Normalization & Key-Value Format', () => {
    it('normalizes single key/value payloads with string timestamps e.g. ACTIVE_HOURS_START = "10:00"', async () => {
      const res = await settingsService.updateSettings({
        key: 'ACTIVE_HOURS_START',
        value: '10:00',
      } as any);

      expect(res.success).toBe(true);
      expect(res.setting?.key).toBe('ACTIVE_HOURS_START');
      expect(res.setting?.value).toBe('10:00');
      expect(res.settings.auto_publish_start_hour).toBe(10);
      expect(res.settings.active_hours_start).toBe('10:00');
    });

    it('normalizes ACTIVE_HOURS_END = "20:00"', async () => {
      const res = await settingsService.updateSettings({
        key: 'ACTIVE_HOURS_END',
        value: '20:00',
      } as any);

      expect(res.success).toBe(true);
      expect(res.setting?.key).toBe('ACTIVE_HOURS_END');
      expect(res.setting?.value).toBe('20:00');
      expect(res.settings.auto_publish_end_hour).toBe(20);
      expect(res.settings.active_hours_end).toBe('20:00');
    });

    it('throws SETTINGS_VERSION_CONFLICT with currentVersion on version mismatch', async () => {
      const current = await settingsService.getSettings();
      const currentVersion = current.settings_version || 1;

      try {
        await settingsService.updateSettings(
          { key: 'MAX_DAILY_POSTS', value: 4 } as any,
          { expectedVersion: currentVersion + 10 }
        );
        expect.unreachable('Should have thrown conflict error');
      } catch (err: any) {
        expect(err.code).toBe('SETTINGS_VERSION_CONFLICT');
        expect(err.currentVersion).toBe(currentVersion);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Test 8: Full Settings Test Matrix (Requirement 29)
  // --------------------------------------------------------------------------
  describe('Full Settings Matrix (Requirement 29: Every Setting Tested)', () => {
    it('persists and validates ACTIVE_HOURS_START and ACTIVE_HOURS_END', async () => {
      const res = await settingsService.updateSettings({
        auto_publish_start_hour: 10,
        auto_publish_end_hour: 20,
      });
      expect(res.settings.auto_publish_start_hour).toBe(10);
      expect(res.settings.auto_publish_end_hour).toBe(20);
      expect(res.settings.active_hours_start).toBe('10:00');
      expect(res.settings.active_hours_end).toBe('20:00');
    });

    it('persists and validates TARGET_DAILY_POSTS and MAX_DAILY_POSTS', async () => {
      const res = await settingsService.updateSettings({
        min_daily_posts: 1,
        target_daily_posts: 3,
        max_daily_posts: 5,
      });
      expect(res.settings.target_daily_posts).toBe(3);
      expect(res.settings.max_daily_posts).toBe(5);
    });

    it('persists and validates MIN_GAP and MAX_GAP', async () => {
      const res = await settingsService.updateSettings({
        min_gap_minutes: 30,
        max_gap_minutes: 75,
      });
      expect(res.settings.min_gap_minutes).toBe(30);
      expect(res.settings.max_gap_minutes).toBe(75);
    });

    it('persists and validates TIMEZONE', async () => {
      const res = await settingsService.updateSettings({
        timezone: 'Asia/Kolkata',
      });
      expect(res.settings.timezone).toBe('Asia/Kolkata');
    });

    it('persists and validates OVERNIGHT_REST toggle', async () => {
      // Overnight rest disabled (24/7)
      const res1 = await settingsService.updateSettings({
        key: 'OVERNIGHT_REST',
        value: false,
      } as any);
      expect(res1.settings.auto_publish_start_hour).toBe(0);
      expect(res1.settings.auto_publish_end_hour).toBe(24);

      // Overnight rest enabled (standard 9 to 22)
      const res2 = await settingsService.updateSettings({
        key: 'OVERNIGHT_REST',
        value: true,
      } as any);
      expect(res2.settings.auto_publish_start_hour).toBe(9);
      expect(res2.settings.auto_publish_end_hour).toBe(22);
    });

    it('persists and validates STRATEGY_AUTHORITY_MODE across all supported modes', async () => {
      for (const mode of ['AUTO', 'AUTO_GROWTH', 'BASELINE', 'MANUAL', 'EXPERIMENT'] as const) {
        const res = await settingsService.updateSettings({
          scheduling_strategy_mode: mode,
        });
        expect(res.settings.scheduling_strategy_mode).toBe(mode);
      }
    });

    it('persists and validates AUTO_PUBLISH and syncs publishing_mode bidirectionally', async () => {
      const resOff = await settingsService.updateSettings({
        auto_publish: false,
      });
      expect(resOff.settings.auto_publish).toBe(false);
      expect(resOff.settings.publishing_mode).toBe('MANUAL_APPROVAL');

      const resOn = await settingsService.updateSettings({
        auto_publish: true,
      });
      expect(resOn.settings.auto_publish).toBe(true);
      expect(resOn.settings.publishing_mode).toBe('AUTO_PUBLISH');
    });
  });
});
