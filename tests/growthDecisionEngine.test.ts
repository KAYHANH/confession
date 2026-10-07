import { describe, it, expect, vi, beforeEach } from 'vitest';
import { growthDecisionEngine } from '../services/growth/growthDecisionEngine';
import { growthMetricsService } from '../services/growth/growthMetricsService';
import { postSaturationService } from '../services/growth/postSaturationService';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { contentScoringService } from '../services/growth/contentScoringService';
import { backtestSimulationService } from '../services/growth/backtestSimulationService';
import { growthStrategyValidator } from '../services/growth/growthStrategyValidator';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';

describe('ConfessionFlow - Growth Intelligence 3.0 Closed-Loop Decision Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    growthDecisionEngine.invalidateCache();
  });

  // -------------------------------------------------------------
  // Test 1: Optimal Daily Frequency & Knee Detection
  // -------------------------------------------------------------
  it('Test 1: should recommend 7 posts/day when frequency saturation analysis detects reach degradation beyond 7', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      max_daily_posts: 12,
      target_daily_posts: 12,
    });

    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [
        { posts_per_day: 3, sample_days: 4, sample_posts: 12, median_reach_per_post: 1200, mean_reach_per_post: 1250, median_total_daily_reach: 3600, median_views_per_post: 1400, median_shares_per_post: 60, median_saves_per_post: 45, median_engagement_rate: 8.7, degradation_percent_vs_peak: 32 },
        { posts_per_day: 5, sample_days: 6, sample_posts: 30, median_reach_per_post: 1420, mean_reach_per_post: 1450, median_total_daily_reach: 7100, median_views_per_post: 1650, median_shares_per_post: 80, median_saves_per_post: 60, median_engagement_rate: 9.8, degradation_percent_vs_peak: 20 },
        { posts_per_day: 7, sample_days: 8, sample_posts: 56, median_reach_per_post: 1780, mean_reach_per_post: 1800, median_total_daily_reach: 12460, median_views_per_post: 2100, median_shares_per_post: 110, median_saves_per_post: 95, median_engagement_rate: 11.5, degradation_percent_vs_peak: 0 },
        { posts_per_day: 10, sample_days: 5, sample_posts: 50, median_reach_per_post: 1050, mean_reach_per_post: 1100, median_total_daily_reach: 10500, median_views_per_post: 1200, median_shares_per_post: 50, median_saves_per_post: 40, median_engagement_rate: 8.5, degradation_percent_vs_peak: 41 },
        { posts_per_day: 12, sample_days: 4, sample_posts: 48, median_reach_per_post: 720, mean_reach_per_post: 750, median_total_daily_reach: 8640, median_views_per_post: 850, median_shares_per_post: 35, median_saves_per_post: 25, median_engagement_rate: 8.3, degradation_percent_vs_peak: 59 },
      ],
      optimal_posts_per_day: 7,
      saturation_knee_point: 10,
      degradation_detected: true,
      confidence: 0.88,
      sample_size: 196,
      days_of_data: 27,
      summary: 'Frequency saturation detected beyond 7 posts/day. Optimal frequency is 7 posts/day.',
    });

    const decision = await growthDecisionEngine.evaluateNextPost();

    expect(decision.daily_strategy.recommended_daily_posts).toBe(7);
    expect(decision.daily_strategy.effective_daily_posts).toBe(7);
    expect(decision.daily_strategy.saturation_detected).toBe(true);
    expect(decision.rationale.factors.frequency).toContain('Saturation knee observed');
  });

  // -------------------------------------------------------------
  // Test 2: Enforce Hard Limits with Strategy Validator
  // -------------------------------------------------------------
  it('Test 2: should clamp daily strategy to settings hard ceiling (e.g. max 5) with SETTINGS_HARD_LIMIT authority', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      min_daily_posts: 2,
      max_daily_posts: 5,
      target_daily_posts: 8,
    });

    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [],
      optimal_posts_per_day: 8,
      saturation_knee_point: null,
      degradation_detected: false,
      confidence: 0.85,
      sample_size: 50,
      days_of_data: 12,
      summary: 'Optimal frequency is 8 posts/day.',
    });

    const decision = await growthDecisionEngine.evaluateNextPost();

    expect(decision.daily_strategy.effective_daily_posts).toBe(5);
    expect(decision.authority_source).toBe('SETTINGS_HARD_LIMIT');
  });

  // -------------------------------------------------------------
  // Test 3: Real-Time Post Velocity > 90th Percentile Holds Next Post
  // -------------------------------------------------------------
  it('Test 3: should return WAIT when current active post is at >90th percentile velocity (1,200 views/hr)', async () => {
    vi.spyOn(postSaturationService, 'getRealtimePostStatus').mockResolvedValue({
      has_active_post: true,
      media_id: 'm-live-viral',
      confession_id: 'c-viral',
      confession_row: 42,
      published_at: new Date(Date.now() - 35 * 60000).toISOString(),
      age_minutes: 35,
      current_views: 700,
      current_reach: 950,
      views_velocity_per_hour: 1200,
      historical_percentile: 94,
      is_accelerating: true,
      is_plateaued: false,
      should_hold_next_post: true,
      hold_duration_minutes_recommended: 60,
      headline_alert: '🔥 Post is outperforming historical baseline (94th percentile).',
      message: 'Recent post is outperforming historical baseline (1200 views/hr, 94th percentile). Holding next post by 60m to give this post more distribution time.',
    });

    const decision = await growthDecisionEngine.evaluateNextPost();

    expect(decision.decision).toBe('WAIT');
    expect(decision.current_post_status?.is_accelerating).toBe(true);
    expect(decision.current_post_status?.historical_percentile).toBe(94);
    expect(decision.rationale.summary).toContain('outperforming historical baseline');
    expect(decision.rationale.factors.real_time_velocity).toContain('94th percentile');
  });

  // -------------------------------------------------------------
  // Test 4: Matured / Plateaued Post Allows Normal Cadence
  // -------------------------------------------------------------
  it('Test 4: should NOT hold next post when current post velocity has plateaued', async () => {
    vi.spyOn(postSaturationService, 'getRealtimePostStatus').mockResolvedValue({
      has_active_post: true,
      media_id: 'm-normal',
      confession_id: 'c-norm',
      confession_row: 40,
      published_at: new Date(Date.now() - 120 * 60000).toISOString(),
      age_minutes: 120,
      current_views: 180,
      current_reach: 250,
      views_velocity_per_hour: 40,
      historical_percentile: 20,
      is_accelerating: false,
      is_plateaued: true,
      should_hold_next_post: false,
      hold_duration_minutes_recommended: 0,
      message: 'No evidence that waiting longer will materially improve this post (40 views/hr, 20th percentile). Resume normal cadence.',
    });

    const mockCandidate: Confession = {
      id: 'c-eligible',
      google_sheet_id: 'sheet-1',
      google_sheet_name: 'Love',
      google_sheet_row: 41,
      name: 'Anonymous',
      original_text: 'Short confession text',
      cleaned_text: 'Short confession text',
      display_name: 'Student',
      is_anonymous: true,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: 'https://example.com/card.png',
      generated_image_path: null,
      caption: 'Love confession',
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
    };

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([mockCandidate]);
    vi.spyOn(contentScoringService, 'rankCandidates').mockResolvedValue([
      { confession: mockCandidate, predictedPerformanceScore: 78 },
    ]);

    const decision = await growthDecisionEngine.evaluateNextPost();

    expect(decision.decision).not.toBe('WAIT');
    expect(decision.current_post_status?.should_hold_next_post).toBe(false);
  });

  // -------------------------------------------------------------
  // Test 5: Format Intelligence: Carousel for Long Confessions (>100 words)
  // -------------------------------------------------------------
  it('Test 5: should recommend CAROUSEL format when confession has > 100 words to ensure swipe dwell time and legibility', async () => {
    const longConfessionWords = Array.from({ length: 135 }, (_, i) => `word${i}`).join(' ');
    const mockCandidate: Confession = {
      id: 'c-long',
      google_sheet_id: 'sheet-1',
      google_sheet_name: 'Relationship',
      google_sheet_row: 55,
      name: 'Anonymous',
      original_text: longConfessionWords,
      cleaned_text: longConfessionWords,
      display_name: 'Student',
      is_anonymous: true,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: null,
      generated_image_path: null,
      caption: 'Long confession',
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
    };

    const decision = await growthDecisionEngine.evaluateNextPost(mockCandidate);

    expect(decision.recommended_format).toBe('CAROUSEL');
    expect(decision.rationale.factors.format).toContain('multi-slide Carousel');
    expect(decision.rationale.factors.format).toContain('>100 words');
  });

  // -------------------------------------------------------------
  // Test 6: Format Intelligence: Single Card for Short Confessions (<40 words)
  // -------------------------------------------------------------
  it('Test 6: should recommend IMAGE format when confession has < 40 words for instant visual punch', async () => {
    const shortConfession = 'I have a huge crush on my chemistry lab partner.';
    const mockCandidate: Confession = {
      id: 'c-short',
      google_sheet_id: 'sheet-1',
      google_sheet_name: 'Crush',
      google_sheet_row: 56,
      name: 'Anonymous',
      original_text: shortConfession,
      cleaned_text: shortConfession,
      display_name: 'Student',
      is_anonymous: true,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: null,
      generated_image_path: null,
      caption: 'Short crush confession',
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
    };

    const decision = await growthDecisionEngine.evaluateNextPost(mockCandidate);

    expect(decision.recommended_format).toBe('IMAGE');
    expect(decision.rationale.factors.format).toContain('Single Card');
    expect(decision.rationale.factors.format).toContain('<100 words');
  });

  // -------------------------------------------------------------
  // Test 7: Quality Gate: HOLD_CONTENT When Available Content Is Low-Quality
  // -------------------------------------------------------------
  it('Test 7: should return HOLD_CONTENT rather than forcing low-quality content to hit volume quota', async () => {
    const weakCandidate: Confession = {
      id: 'c-weak',
      google_sheet_id: 'sheet-1',
      google_sheet_name: 'Random',
      google_sheet_row: 57,
      name: 'Anonymous',
      original_text: 'hello lol',
      cleaned_text: 'hello lol',
      display_name: 'Student',
      is_anonymous: true,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: 'tpl-1',
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
      predicted_performance_score: 35, // Below minimum threshold (55)
    };

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([weakCandidate]);
    // ContentScoringService filters out candidate below threshold
    vi.spyOn(contentScoringService, 'rankCandidates').mockResolvedValue([]);

    const decision = await growthDecisionEngine.evaluateNextPost();

    expect(decision.decision).toBe('HOLD_CONTENT');
    expect(decision.rationale.summary).toContain('HOLD CONTENT');
  });

  // -------------------------------------------------------------
  // Test 8: Content Mix Intelligence Efficiency Ratio
  // -------------------------------------------------------------
  it('Test 8: should calculate category efficiency ratio and recommend INCREASE for high-efficiency categories', async () => {
    vi.spyOn(growthMetricsService, 'getOrSyncPostPerformanceRecords').mockResolvedValue([
      // Funny category: 3 posts, 6,000 reach (high efficiency)
      { post_id: 'p1', instagram_media_id: 'm1', content_id: 'c1', published_at: new Date().toISOString(), format: 'IMAGE', media_type: 'IMAGE', confession_category: 'funny', hook_type: 'CURIOSITY', content_length: 50, word_count: 30, character_count: 150, day_of_week: 1, publish_hour: 20, publish_minute: 0, previous_post_gap_minutes: 90, posts_in_previous_1h: 0, posts_in_previous_3h: 1, posts_in_previous_6h: 2, posts_in_previous_24h: 5, first_observed_views_at: null, minutes_until_first_observed_view: 5, peak_growth_window: null, peak_growth_start_age: 0, peak_growth_end_age: 60, peak_growth_velocity: 800, peak_clock_window: null, views_1h: 600, views_3h: 1200, views_6h: 1800, views_12h: 2000, views_24h: 2200, views_48h: 2250, views_72h: 2260, views_7d: 2270, final_observed_views: 2300, final_observed_reach: 2000, final_observed_shares: 80, final_observed_saves: 40, final_observed_comments: 20, final_observed_profile_visits: 30, final_observed_follows: 5, performance_index: 85, percentile: 90, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { post_id: 'p2', instagram_media_id: 'm2', content_id: 'c2', published_at: new Date().toISOString(), format: 'IMAGE', media_type: 'IMAGE', confession_category: 'funny', hook_type: 'CURIOSITY', content_length: 50, word_count: 30, character_count: 150, day_of_week: 1, publish_hour: 20, publish_minute: 0, previous_post_gap_minutes: 90, posts_in_previous_1h: 0, posts_in_previous_3h: 1, posts_in_previous_6h: 2, posts_in_previous_24h: 5, first_observed_views_at: null, minutes_until_first_observed_view: 5, peak_growth_window: null, peak_growth_start_age: 0, peak_growth_end_age: 60, peak_growth_velocity: 800, peak_clock_window: null, views_1h: 600, views_3h: 1200, views_6h: 1800, views_12h: 2000, views_24h: 2200, views_48h: 2250, views_72h: 2260, views_7d: 2270, final_observed_views: 2300, final_observed_reach: 2000, final_observed_shares: 80, final_observed_saves: 40, final_observed_comments: 20, final_observed_profile_visits: 30, final_observed_follows: 5, performance_index: 85, percentile: 90, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      // Other category: 7 posts, 2,000 reach (low efficiency)
      ...Array.from({ length: 7 }, (_, i) => ({
        post_id: `p_oth_${i}`, instagram_media_id: `m_oth_${i}`, content_id: `c_oth_${i}`, published_at: new Date().toISOString(), format: 'IMAGE' as const, media_type: 'IMAGE', confession_category: 'other', hook_type: 'DIRECT_STATEMENT' as const, content_length: 40, word_count: 25, character_count: 120, day_of_week: 2, publish_hour: 15, publish_minute: 0, previous_post_gap_minutes: 60, posts_in_previous_1h: 1, posts_in_previous_3h: 2, posts_in_previous_6h: 3, posts_in_previous_24h: 8, first_observed_views_at: null, minutes_until_first_observed_view: 10, peak_growth_window: null, peak_growth_start_age: 0, peak_growth_end_age: 60, peak_growth_velocity: 200, peak_clock_window: null, views_1h: 150, views_3h: 250, views_6h: 300, views_12h: 320, views_24h: 330, views_48h: 340, views_72h: 340, views_7d: 340, final_observed_views: 350, final_observed_reach: 285, final_observed_shares: 5, final_observed_saves: 2, final_observed_comments: 1, final_observed_profile_visits: 2, final_observed_follows: 0, performance_index: 25, percentile: 20, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }))
    ]);

    const mix = await growthMetricsService.getContentMixStrategy();

    const funnyMix = mix.find((m) => m.category === 'funny');
    expect(funnyMix).toBeDefined();
    expect(funnyMix!.efficiency_ratio).toBeGreaterThan(1.2);
    expect(funnyMix!.recommendation).toBe('INCREASE');
  });

  // -------------------------------------------------------------
  // Test 9: Counterfactual Backtesting Simulation
  // -------------------------------------------------------------
  it('Test 9: should run simulation comparing actual schedule vs Growth Intelligence counterfactual strategy', async () => {
    vi.spyOn(growthMetricsService, 'getPostingFrequencySaturationAnalysis').mockResolvedValue({
      buckets: [
        { posts_per_day: 7, sample_days: 10, sample_posts: 70, median_reach_per_post: 1600, mean_reach_per_post: 1600, median_total_daily_reach: 11200, median_views_per_post: 1800, median_shares_per_post: 90, median_saves_per_post: 70, median_engagement_rate: 10.0, degradation_percent_vs_peak: 0 },
        { posts_per_day: 12, sample_days: 10, sample_posts: 120, median_reach_per_post: 700, mean_reach_per_post: 700, median_total_daily_reach: 8400, median_views_per_post: 800, median_shares_per_post: 30, median_saves_per_post: 20, median_engagement_rate: 7.1, degradation_percent_vs_peak: 56 },
      ],
      optimal_posts_per_day: 7,
      saturation_knee_point: 8,
      degradation_detected: true,
      confidence: 0.90,
      sample_size: 190,
      days_of_data: 20,
      summary: 'Optimal frequency is 7 posts/day.',
    });

    const mockRecords = Array.from({ length: 12 }, (_, i) => ({
      post_id: `rec-${i}`,
      instagram_media_id: `media-${i}`,
      content_id: `c-${i}`,
      published_at: '2026-10-06T12:00:00.000Z',
      format: 'IMAGE' as const,
      media_type: 'IMAGE',
      confession_category: 'love',
      hook_type: 'CURIOSITY' as const,
      content_length: 50,
      word_count: 35,
      character_count: 150,
      day_of_week: 2,
      publish_hour: 12,
      publish_minute: i * 5,
      previous_post_gap_minutes: 30,
      posts_in_previous_1h: 2,
      posts_in_previous_3h: 5,
      posts_in_previous_6h: 8,
      posts_in_previous_24h: 12,
      first_observed_views_at: null,
      minutes_until_first_observed_view: 5,
      peak_growth_window: null,
      peak_growth_start_age: 0,
      peak_growth_end_age: 60,
      peak_growth_velocity: 300,
      peak_clock_window: null,
      views_1h: 300,
      views_3h: 600,
      views_6h: 700,
      views_12h: 750,
      views_24h: 800,
      views_48h: 800,
      views_72h: 800,
      views_7d: 800,
      final_observed_views: 800,
      final_observed_reach: 700,
      final_observed_shares: 20,
      final_observed_saves: 15,
      final_observed_comments: 5,
      final_observed_profile_visits: 10,
      final_observed_follows: 1,
      performance_index: 45,
      percentile: 40,
      created_at: '2026-10-06T12:00:00.000Z',
      updated_at: '2026-10-06T12:00:00.000Z',
    }));

    vi.spyOn(growthMetricsService, 'getOrSyncPostPerformanceRecords').mockResolvedValue(mockRecords);

    const simulation = await backtestSimulationService.runSimulation(30);

    expect(simulation.baseline_posts_count).toBe(12);
    expect(simulation.simulated_posts_count).toBe(7); // Capped from 12 to 7
    expect(simulation.projected_reach_lift_pct).toBeGreaterThan(0);
    expect(simulation.daily_comparisons.length).toBeGreaterThan(0);
    expect(simulation.summary).toContain('fewer');
  });
});
