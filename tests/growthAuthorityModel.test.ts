import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { growthMetricsService } from '../services/growth/growthMetricsService';
import { schedulingService } from '../services/schedulingService';
import { mockStore } from '../lib/mockStore';
import { confessionService } from '../services/confessionService';
import { postSaturationService } from '../services/growth/postSaturationService';
import { Confession } from '../types';

describe('ConfessionFlow - Final Scheduling Authority Model', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cadenceAnalyzer.invalidateCache();
  });

  // -------------------------------------------------------------
  // Test 1: Growth Intelligence overrides Target when evidence is sufficient
  // -------------------------------------------------------------
  it('Test 1: should allow Growth Intelligence to override TARGET_DAILY_POSTS when empirical evidence is sufficient', async () => {
    // Settings: Target is 12, Min is 2, Max is 12
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 12,
      max_daily_posts: 12,
      min_posts_for_cadence_learning: 20,
      min_days_for_cadence_learning: 7,
      min_growth_confidence: 0.70,
      scheduling_strategy_mode: 'AUTO',
    });

    // Mock saturation analysis with sufficient evidence: 24 posts across 8 days, optimal is 8/day
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [
        {
          posts_per_day: 8,
          sample_days: 4,
          sample_posts: 32,
          median_reach_per_post: 3200,
          mean_reach_per_post: 3100,
          median_total_daily_reach: 25600,
          median_views_per_post: 4000,
          median_shares_per_post: 120,
          median_saves_per_post: 80,
          median_engagement_rate: 6.2,
          degradation_percent_vs_peak: 0,
        },
        {
          posts_per_day: 12,
          sample_days: 4,
          sample_posts: 48,
          median_reach_per_post: 1700,
          mean_reach_per_post: 1650,
          median_total_daily_reach: 20400,
          median_views_per_post: 2100,
          median_shares_per_post: 50,
          median_saves_per_post: 30,
          median_engagement_rate: 3.8,
          degradation_percent_vs_peak: 46.9,
        },
      ],
      optimal_posts_per_day: 8,
      saturation_knee_point: 8,
      degradation_detected: true,
      confidence: 0.85,
      sample_size: 80,
      days_of_data: 8,
      summary: 'Optimal frequency is 8 posts/day. Significant degradation (46.9%) observed at 12 posts/day.',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.is_fallback).toBe(false);
    expect(plan.authority_source).toBe('GROWTH_INTELLIGENCE');
    expect(plan.recommended_posts).toBe(8);
    // Effective daily posts must be 8, overriding target 12!
    expect(plan.effective_daily_posts).toBe(8);
    expect(plan.target_fallback_posts).toBe(12);
    expect(plan.confidence).toBe(0.85);
    expect(plan.reason).toContain('Growth Intelligence authoritative');
    expect(plan.reason).toContain('Overriding target (12/day)');
  });

  // -------------------------------------------------------------
  // Test 2: Hard MAX is never exceeded
  // -------------------------------------------------------------
  it('Test 2: should clamp Growth recommendations strictly to MAX_DAILY_POSTS hard ceiling', async () => {
    // Settings: Hard MAX is 6, Min is 2
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 5,
      max_daily_posts: 6,
      min_posts_for_cadence_learning: 20,
      min_days_for_cadence_learning: 7,
      min_growth_confidence: 0.70,
      scheduling_strategy_mode: 'AUTO',
    });

    // Growth Intelligence recommends 10 posts/day
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 10,
      saturation_knee_point: null,
      degradation_detected: false,
      confidence: 0.90,
      sample_size: 40,
      days_of_data: 10,
      summary: 'Optimal frequency is 10 posts/day.',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.is_fallback).toBe(false);
    expect(plan.recommended_posts).toBe(10);
    // Clamped strictly to max_daily_posts = 6!
    expect(plan.effective_daily_posts).toBe(6);
    expect(plan.authority_source).toBe('SETTINGS_HARD_LIMIT');
    expect(plan.reason).toContain('clamped to 6 by hard settings limits [2-6]');
  });

  // -------------------------------------------------------------
  // Test 3: Hard MIN is respected
  // -------------------------------------------------------------
  it('Test 3: should enforce MIN_DAILY_POSTS hard floor when Growth recommends very low volume', async () => {
    // Settings: Hard MIN is 3, Max is 10
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 3,
      target_daily_posts: 5,
      max_daily_posts: 10,
      min_posts_for_cadence_learning: 20,
      min_days_for_cadence_learning: 7,
      min_growth_confidence: 0.70,
      scheduling_strategy_mode: 'AUTO',
    });

    // Growth Intelligence recommends 1 post/day
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 1,
      saturation_knee_point: 1,
      degradation_detected: true,
      confidence: 0.80,
      sample_size: 25,
      days_of_data: 9,
      summary: 'Optimal frequency is 1 post/day.',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.recommended_posts).toBe(1);
    // Clamped strictly up to min_daily_posts = 3!
    expect(plan.effective_daily_posts).toBe(3);
    expect(plan.authority_source).toBe('SETTINGS_HARD_LIMIT');
  });

  // -------------------------------------------------------------
  // Test 4: Lower recommendations are fully valid and respected
  // -------------------------------------------------------------
  it('Test 4: should honor lower recommendations (3/day vs target 8/day) without forcing the target', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 8,
      max_daily_posts: 12,
      min_posts_for_cadence_learning: 20,
      min_days_for_cadence_learning: 7,
      min_growth_confidence: 0.70,
      scheduling_strategy_mode: 'AUTO',
    });

    // Saturation analysis shows 3 posts/day has highest reach per post, 8/day degraded by 50%
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 3,
      saturation_knee_point: 3,
      degradation_detected: true,
      confidence: 0.78,
      sample_size: 35,
      days_of_data: 12,
      summary: 'Optimal frequency is 3 posts/day.',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.is_fallback).toBe(false);
    expect(plan.authority_source).toBe('GROWTH_INTELLIGENCE');
    expect(plan.effective_daily_posts).toBe(3);
    expect(plan.target_fallback_posts).toBe(8);
  });

  // -------------------------------------------------------------
  // Test 5: Target is used as fallback when sample size or confidence is insufficient
  // -------------------------------------------------------------
  it('Test 5: should fall back to TARGET_DAILY_POSTS when sample size < 20 or days < 7 or confidence < 0.70', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 5,
      max_daily_posts: 12,
      min_posts_for_cadence_learning: 20,
      min_days_for_cadence_learning: 7,
      min_growth_confidence: 0.70,
      scheduling_strategy_mode: 'AUTO',
    });

    // Insufficient sample: only 8 posts across 3 days, low confidence 0.35
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 3,
      saturation_knee_point: null,
      degradation_detected: false,
      confidence: 0.35,
      sample_size: 8,
      days_of_data: 3,
      summary: 'Insufficient data.',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.is_fallback).toBe(true);
    expect(plan.authority_source).toBe('SETTINGS_FALLBACK');
    // Must fall back to target_daily_posts = 5!
    expect(plan.effective_daily_posts).toBe(5);
    expect(plan.reason).toContain('Insufficient historical evidence');
  });

  // -------------------------------------------------------------
  // Test 6: Rolling Horizon (12–24h) leaves excess items in APPROVED
  // -------------------------------------------------------------
  it('Test 6: should enforce rolling horizon and leave excess queue items in APPROVED status without blind scheduling', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 4,
      max_daily_posts: 12,
      rolling_horizon_hours: 24,
      timezone: 'Asia/Kolkata',
      auto_publish_start_hour: 9,
      auto_publish_end_hour: 22,
    });

    // Mock plan: 3 posts planned for today
    vi.spyOn(cadenceAnalyzer, 'generateDailyGrowthPlan').mockResolvedValue({
      date: '2026-10-06',
      recommended_posts: 3,
      effective_daily_posts: 3,
      min_allowed_posts: 2,
      max_allowed_posts: 12,
      target_fallback_posts: 4,
      confidence: 0.80,
      sample_size: 25,
      days_of_data: 8,
      is_fallback: false,
      authority_source: 'GROWTH_INTELLIGENCE',
      preferred_windows: [{ start: '18:00', end: '21:00' }],
      recommended_spacing: { min_minutes: 60, max_minutes: 90 },
      preferred_categories: ['crush'],
      preferred_formats: ['CAROUSEL'],
      reason: 'Optimal 3 posts/day',
      saturation_detected: false,
      rolling_horizon_hours: 24,
      generated_at: new Date().toISOString(),
    });

    // Create 10 approved confessions
    const mockConfessions: Confession[] = [];
    for (let i = 1; i <= 10; i++) {
      mockConfessions.push({
        id: `conf-horizon-${i}`,
        google_sheet_row: i,
        status: 'APPROVED',
        scheduled_at: null,
        cleaned_text: `Confession #${i}`,
        original_text: `Confession #${i}`,
        name: 'Anon',
        display_name: 'Anon',
        is_anonymous: true,
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: 'Caption',
        hashtags: [],
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Sheet1',
      });
    }

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions);
    vi.spyOn(confessionService, 'updateConfession').mockImplementation(async (id, updates) => {
      const target = mockConfessions.find((c) => c.id === id)!;
      Object.assign(target, updates);
      return target;
    });

    // Schedule using generateQueueSchedule (which enforces rolling 24h horizon)
    const result = await schedulingService.generateQueueSchedule({
      forceRecalculate: true,
      rollingHorizonHours: 24,
    });

    // In a 24-hour horizon with effective cap = 3/day, only up to 3 slots for today (and up to 3 for tomorrow if within 24h) are scheduled
    // Crucially, it must NOT schedule all 10 items 4-5 days ahead!
    expect(result.newlyScheduledCount).toBeLessThan(10);

    const scheduledCount = mockConfessions.filter((c) => c.status === 'SCHEDULED' && c.scheduled_at).length;
    const approvedCount = mockConfessions.filter((c) => c.status === 'APPROVED' && !c.scheduled_at).length;

    expect(scheduledCount).toBe(result.newlyScheduledCount);
    expect(approvedCount).toBeGreaterThan(0);
    expect(scheduledCount + approvedCount).toBe(10);
  });

  // -------------------------------------------------------------
  // Test 7: Post Velocity Hold delays next scheduled post
  // -------------------------------------------------------------
  it('Test 7: should hold next post when current post is actively accelerating', async () => {
    vi.spyOn(postSaturationService, 'evaluateSaturation').mockResolvedValue({
      hasRecentPost: true,
      shouldDelayNextPost: true,
      isAccelerating: true,
      currentPostAgeMinutes: 45,
      currentPostViews: 1200,
      currentPostReach: 1500,
      earlyVelocityViewsPerHour: 850,
      recommendedWaitMinutes: 90,
      reason: 'Recent post #42 is actively accelerating (850 views/hr). Holding next post by 90m to avoid reach cannibalization.',
    });

    const cycleResult = await schedulingService.processAutoPublishCycle(false);

    expect(cycleResult.ran).toBe(false);
    expect(cycleResult.status).toBe('RATE_LIMITED');
    expect(cycleResult.reason).toContain('saturation hold');
    expect(cycleResult.reason).toContain('actively accelerating');
  });

  // -------------------------------------------------------------
  // Test 8: Admin Manual Override is strictly respected
  // -------------------------------------------------------------
  it('Test 8: should respect ADMIN_OVERRIDE mode even if empirical evidence suggests otherwise', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      target_daily_posts: 6,
      max_daily_posts: 12,
      scheduling_strategy_mode: 'MANUAL',
      manual_fixed_gap_minutes: 90,
    });

    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 10,
      saturation_knee_point: null,
      degradation_detected: false,
      confidence: 0.95,
      sample_size: 50,
      days_of_data: 14,
      summary: 'Optimal is 10 posts/day',
    });

    const plan = await cadenceAnalyzer.generateDailyGrowthPlan(new Date(), true);

    expect(plan.authority_source).toBe('ADMIN_OVERRIDE');
    expect(plan.is_fallback).toBe(true);
    expect(plan.effective_daily_posts).toBe(6);
    expect(plan.reason).toContain('Admin override mode active');
  });
});
