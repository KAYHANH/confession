import { describe, it, expect, vi, beforeEach } from 'vitest';
import { growthMetricsService } from '../services/growth/growthMetricsService';
import { growthSchedulingAgent, GroqSchedulingRecommendationSchema } from '../services/growth/growthSchedulingAgent';
import { scheduleValidationService } from '../services/growth/scheduleValidationService';
import { recommendationLearningService } from '../services/growth/recommendationLearningService';
import { growthStore } from '../lib/growthStore';
import { mockStore } from '../lib/mockStore';
import { experimentService } from '../services/growth/experimentService';
import {
  MediaPerformanceSnapshot,
  PublishedMedia,
  PostPerformanceRecord,
  GroqSchedulingRecommendation,
  PostingExperiment,
} from '../types/growth';
import { Confession } from '../types';

describe('Growth Intelligence Account-Level Learning & Adaptive Scheduling Brain', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Time to first observed views
  // -------------------------------------------------------------------------
  it('Test 1: should calculate time to first observed views from earliest snapshot with views > 0', () => {
    const publishedAt = '2026-10-05T10:00:00.000Z';
    const snapshots: MediaPerformanceSnapshot[] = [
      {
        id: 's-15m',
        published_media_id: 'm-1',
        collected_at: '2026-10-05T10:15:00.000Z',
        target_age_minutes: 15,
        actual_age_minutes: 15,
        age_bucket: '15m',
        views: 0,
        reach: 0,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T10:15:00.000Z',
      },
      {
        id: 's-30m',
        published_media_id: 'm-1',
        collected_at: '2026-10-05T10:30:00.000Z',
        target_age_minutes: 30,
        actual_age_minutes: 30,
        age_bucket: '30m',
        views: 120,
        reach: 180,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T10:30:00.000Z',
      },
      {
        id: 's-60m',
        published_media_id: 'm-1',
        collected_at: '2026-10-05T11:00:00.000Z',
        target_age_minutes: 60,
        actual_age_minutes: 60,
        age_bucket: '60m',
        views: 450,
        reach: 520,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T11:00:00.000Z',
      },
    ];

    const result = growthMetricsService.calculateTimeToFirstObservedViews(snapshots, publishedAt);
    expect(result.firstObservedViewsAt).toBe('2026-10-05T10:30:00.000Z');
    expect(result.minutesUntilFirstObservedView).toBe(30);

    // If all snapshots are 0 views, return null
    const zeroSnapshots = [snapshots[0]];
    const zeroResult = growthMetricsService.calculateTimeToFirstObservedViews(zeroSnapshots, publishedAt);
    expect(zeroResult.firstObservedViewsAt).toBeNull();
    expect(zeroResult.minutesUntilFirstObservedView).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 2: Peak growth window
  // -------------------------------------------------------------------------
  it('Test 2: should determine peak growth window based on highest views increase per hour, not just highest total views', () => {
    const publishedAt = '2026-10-05T14:45:00.000Z'; // 8:15 PM IST
    const snapshots: MediaPerformanceSnapshot[] = [
      {
        id: 's-30m',
        published_media_id: 'm-2',
        collected_at: '2026-10-05T15:15:00.000Z',
        target_age_minutes: 30,
        actual_age_minutes: 30,
        age_bucket: '30m',
        views: 60, // 0-30m: 60 views in 0.5h = 120 v/hr
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T15:15:00.000Z',
      },
      {
        id: 's-60m',
        published_media_id: 'm-2',
        collected_at: '2026-10-05T15:45:00.000Z',
        target_age_minutes: 60,
        actual_age_minutes: 60,
        age_bucket: '60m',
        views: 215, // 30-60m: 155 views in 0.5h = 310 v/hr (PEAK!)
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T15:45:00.000Z',
      },
      {
        id: 's-180m',
        published_media_id: 'm-2',
        collected_at: '2026-10-05T17:45:00.000Z',
        target_age_minutes: 180,
        actual_age_minutes: 180,
        age_bucket: '3h',
        views: 575, // 60-180m: 360 views in 2h = 180 v/hr (Higher total, but lower rate)
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T17:45:00.000Z',
      },
    ];

    const peak = growthMetricsService.calculatePeakGrowthWindow(snapshots, publishedAt);
    expect(peak.peak_growth_window).toBe('30–60m');
    expect(peak.peak_growth_start_age).toBe(30);
    expect(peak.peak_growth_end_age).toBe(60);
    expect(peak.peak_growth_velocity).toBe(310);
    expect(peak.peak_clock_window).toBeDefined();
    expect(peak.peak_clock_window).toContain('PM');
  });

  // -------------------------------------------------------------------------
  // Test 3: Peak velocity & Deltas
  // -------------------------------------------------------------------------
  it('Test 3: should calculate performance velocity per hour accurately using actual elapsed minutes between snapshots', () => {
    const snapshots: MediaPerformanceSnapshot[] = [
      {
        id: 's-1',
        published_media_id: 'm-3',
        collected_at: '2026-10-05T10:30:00.000Z',
        target_age_minutes: 30,
        actual_age_minutes: 30,
        age_bucket: '30m',
        views: 100,
        reach: 150,
        shares: 10,
        saves: 5,
        comments: 2,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T10:30:00.000Z',
      },
      {
        id: 's-2',
        published_media_id: 'm-3',
        collected_at: '2026-10-05T11:00:00.000Z',
        target_age_minutes: 60,
        actual_age_minutes: 60,
        age_bucket: '60m',
        views: 250, // delta = 150 views in 30 minutes = 300 v/hr
        reach: 350,
        shares: 25,
        saves: 15,
        comments: 6,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T11:00:00.000Z',
      },
    ];

    const enriched = growthMetricsService.calculateSnapshotDeltasAndVelocities(snapshots);
    expect(enriched).toHaveLength(2);

    // Second snapshot verification
    const second = enriched[1];
    expect(second.views_delta).toBe(150);
    expect(second.reach_delta).toBe(200);
    expect(second.share_delta).toBe(15);
    expect(second.save_delta).toBe(10);
    expect(second.comment_delta).toBe(4);
    expect(second.views_velocity_per_hour).toBe(300);
  });

  // -------------------------------------------------------------------------
  // Test 4: Milestone views (24h, 7d, etc.)
  // -------------------------------------------------------------------------
  it('Test 4: should accurately calculate milestone views without converting uncollected milestones to zero', () => {
    const snapshots: MediaPerformanceSnapshot[] = [
      {
        id: 's-1h',
        published_media_id: 'm-4',
        collected_at: '2026-10-05T11:00:00.000Z',
        target_age_minutes: 60,
        actual_age_minutes: 60,
        age_bucket: '60m',
        views: 200,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-05T11:00:00.000Z',
      },
      {
        id: 's-24h',
        published_media_id: 'm-4',
        collected_at: '2026-10-06T10:00:00.000Z',
        target_age_minutes: 1440,
        actual_age_minutes: 1440,
        age_bucket: '24h',
        views: 1850,
        api_version: 'v21.0',
        collection_status: 'SUCCESS',
        unsupported_metrics: [],
        raw_metric_status: {},
        created_at: '2026-10-06T10:00:00.000Z',
      },
    ];

    const milestones = growthMetricsService.calculateMilestoneViews(snapshots);
    expect(milestones.views_1h).toBe(200);
    expect(milestones.views_24h).toBe(1850);
    expect(milestones.views_48h).toBeNull();
    expect(milestones.views_7d).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 5: Category median analysis
  // -------------------------------------------------------------------------
  it('Test 5: should aggregate category growth stats using medians to prevent distortion from viral outliers', async () => {
    const mockRecords: Partial<PostPerformanceRecord>[] = [
      {
        post_id: 'p-1',
        confession_category: 'relationship',
        format: 'IMAGE',
        final_observed_views: 300,
        final_observed_reach: 400,
        final_observed_shares: 20,
        views_24h: 300,
      },
      {
        post_id: 'p-2',
        confession_category: 'relationship',
        format: 'IMAGE',
        final_observed_views: 400,
        final_observed_reach: 500,
        final_observed_shares: 25,
        views_24h: 400,
      },
      {
        post_id: 'p-3',
        confession_category: 'relationship',
        format: 'IMAGE',
        final_observed_views: 50000, // Massive viral outlier
        final_observed_reach: 60000,
        final_observed_shares: 1500,
        views_24h: 50000,
      },
    ];

    vi.spyOn(growthStore, 'getPostPerformanceRecords').mockResolvedValue(mockRecords as PostPerformanceRecord[]);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);

    const catStats = await growthMetricsService.getCategoryGrowthAnalysis();
    const rel = catStats.find((c) => c.category === 'relationship');
    expect(rel).toBeDefined();
    expect(rel?.post_count).toBe(3);
    // Median is 400, whereas mean would be ~16900
    expect(rel?.median_views).toBe(400);
    expect(rel?.mean_views).toBeGreaterThan(10000);
    expect(rel?.median_reach).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Test 6: Format median comparison
  // -------------------------------------------------------------------------
  it('Test 6: should compare formats (IMAGE vs REEL vs CAROUSEL) and reflect statistical sample support', async () => {
    const mockRecords: Partial<PostPerformanceRecord>[] = [
      { post_id: 'f-1', format: 'IMAGE', final_observed_reach: 500, final_observed_views: 400 },
      { post_id: 'f-2', format: 'IMAGE', final_observed_reach: 600, final_observed_views: 500 },
      { post_id: 'f-3', format: 'REEL', final_observed_reach: 1200, final_observed_views: 1500 },
      { post_id: 'f-4', format: 'REEL', final_observed_reach: 1800, final_observed_views: 2200 },
    ];

    vi.spyOn(growthStore, 'getPostPerformanceRecords').mockResolvedValue(mockRecords as PostPerformanceRecord[]);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);

    const fmtStats = await growthMetricsService.getFormatDetailedAnalysis();
    const imageFmt = fmtStats.find((f) => f.format_type === 'IMAGE');
    const reelFmt = fmtStats.find((f) => f.format_type === 'REEL');

    expect(imageFmt?.sample_size).toBe(2);
    expect(imageFmt?.support_state).toBe('INSUFFICIENT_DATA');
    expect(reelFmt?.median_reach).toBe(1500);
    expect(reelFmt?.median_views).toBe(1850);
  });

  // -------------------------------------------------------------------------
  // Test 7: Time window analysis
  // -------------------------------------------------------------------------
  it('Test 7: should calculate publish-time hourly analysis in account timezone', async () => {
    const mockRecords: Partial<PostPerformanceRecord>[] = [
      { post_id: 't-1', publish_hour: 20, final_observed_reach: 800, final_observed_views: 700 },
      { post_id: 't-2', publish_hour: 20, final_observed_reach: 1200, final_observed_views: 1100 },
      { post_id: 't-3', publish_hour: 14, final_observed_reach: 300, final_observed_views: 250 },
    ];

    vi.spyOn(growthStore, 'getPostPerformanceRecords').mockResolvedValue(mockRecords as PostPerformanceRecord[]);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);

    const timeStats = await growthMetricsService.getDetailedTimeSlotAnalysis();
    const h20 = timeStats.find((t) => t.hour_of_day === 20);
    expect(h20).toBeDefined();
    expect(h20?.sample_size).toBe(2);
    expect(h20?.median_reach).toBe(1000);
    expect(h20?.bucket_label).toBe('20:00 - 21:00');
  });

  // -------------------------------------------------------------------------
  // Test 8: Post gap analysis with non-causal phrasing
  // -------------------------------------------------------------------------
  it('Test 8: should aggregate post gap performance and enforce observational non-causal reporting', async () => {
    const mockRecords: Partial<PostPerformanceRecord>[] = [
      { post_id: 'g-1', previous_post_gap_minutes: 75, final_observed_reach: 1400, final_observed_views: 1200 },
      { post_id: 'g-2', previous_post_gap_minutes: 85, final_observed_reach: 1600, final_observed_views: 1500 },
      { post_id: 'g-3', previous_post_gap_minutes: 20, final_observed_reach: 400, final_observed_views: 350 },
    ];

    vi.spyOn(growthStore, 'getPostPerformanceRecords').mockResolvedValue(mockRecords as PostPerformanceRecord[]);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);

    const gapStats = await growthMetricsService.getDetailedPostGapAnalysis();
    const g6090 = gapStats.find((g) => g.gap_bucket === '60–90m');
    expect(g6090).toBeDefined();
    expect(g6090?.sample_size).toBe(2);
    expect(g6090?.median_reach).toBe(1500);
    expect(g6090?.observational_finding).toContain('in the observed sample');
    expect(g6090?.observational_finding).not.toContain('causes');
  });

  // -------------------------------------------------------------------------
  // Test 9: Post density analysis
  // -------------------------------------------------------------------------
  it('Test 9: should calculate post density across preceding 1h, 3h, 6h, and 24h windows', async () => {
    const mockRecords: Partial<PostPerformanceRecord>[] = [
      { post_id: 'd-1', posts_in_previous_3h: 1, final_observed_reach: 900, final_observed_views: 800 },
      { post_id: 'd-2', posts_in_previous_3h: 2, final_observed_reach: 600, final_observed_views: 500 },
      { post_id: 'd-3', posts_in_previous_3h: 2, final_observed_reach: 700, final_observed_views: 650 },
    ];

    vi.spyOn(growthStore, 'getPostPerformanceRecords').mockResolvedValue(mockRecords as PostPerformanceRecord[]);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);

    const densityStats = await growthMetricsService.getPostDensityAnalysis();
    const d3h2p = densityStats.find((d) => d.window_hours === 3 && d.density_bucket === '2 posts');
    expect(d3h2p).toBeDefined();
    expect(d3h2p?.sample_size).toBe(2);
    expect(d3h2p?.median_reach).toBe(650);
  });

  // -------------------------------------------------------------------------
  // Test 10: Recommendation generation
  // -------------------------------------------------------------------------
  it('Test 10: should generate complete structured recommendation matching domain schema', async () => {
    // Generate fallback recommendation
    const rec = growthSchedulingAgent.generateFallbackRecommendation(12, 'Test sample available');
    expect(rec.strategy).toBe('BASELINE_EXPLORATION');
    expect(rec.recommended_format).toBe('IMAGE');
    expect(rec.recommended_publish_window).toBeDefined();
    expect(rec.recommended_gap_minutes.min).toBeGreaterThan(0);
    expect(rec.confidence).toBe('LOW');
    expect(rec.exploration.enabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 11: Groq JSON validation
  // -------------------------------------------------------------------------
  it('Test 11: should strictly validate Groq recommendation JSON against Zod schema', () => {
    const validJson: GroqSchedulingRecommendation = {
      strategy: 'PEAK_VELOCITY_TARGETING',
      recommended_format: 'REEL',
      recommended_publish_window: { start: '19:30', end: '21:00' },
      recommended_gap_minutes: { min: 60, max: 90 },
      recommended_posts_per_3h: 1,
      recommended_next_publish_at: '2026-10-05T20:00:00.000Z',
      wait_before_publishing_minutes: 75,
      confidence: 'HIGH',
      evidence_count: 24,
      reason: 'Observed sample shows high reel velocity at 20:00.',
      alternative: { format: 'IMAGE', window: '21:00 - 22:00' },
      exploration: { enabled: true, percentage: 20 },
    };

    const parsed = GroqSchedulingRecommendationSchema.parse(validJson);
    expect(parsed.strategy).toBe('PEAK_VELOCITY_TARGETING');
    expect(parsed.recommended_format).toBe('REEL');

    // Invalid JSON missing fields must throw
    const invalidJson = { strategy: 'INVALID' };
    expect(() => GroqSchedulingRecommendationSchema.parse(invalidJson)).toThrow();
  });

  // -------------------------------------------------------------------------
  // Test 12: Invalid Groq fallback
  // -------------------------------------------------------------------------
  it('Test 12: should gracefully fall back to deterministic recommendation if Groq fails or returns invalid JSON', async () => {
    vi.spyOn(growthMetricsService, 'getAccountLearningSummary').mockResolvedValue({
      total_posts_analyzed: 8,
      median_views: 600,
      mean_views: 700,
      views_distribution: { p25: 400, p50: 600, p75: 800, p90: 1000 },
      median_reach: 800,
      mean_reach: 900,
      reach_distribution: { p25: 500, p50: 800, p75: 1100, p90: 1400 },
      median_shares: 20,
      median_saves: 15,
      median_comments: 5,
      median_profile_visits: 10,
      median_follows: 2,
      median_24h_views: 550,
      median_48h_views: 580,
      median_peak_velocity: 150,
      median_time_to_first_observed_view: 25,
      best_performing_category: 'crush',
      best_performing_format: 'CAROUSEL',
      best_observed_window: '20:00 - 21:00',
      best_observed_post_growth_window: '30–60m',
      best_observed_cadence: '60–90m spacing',
      evidence_count: 8,
      confidence: 'MEDIUM',
      disclaimer: 'Observed sample.',
    });

    const rec = await growthSchedulingAgent.getNextSchedulingRecommendation();
    expect(rec).toBeDefined();
    expect(rec.recommended_format).toBeDefined();
    expect(rec.recommended_publish_window).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 13: Insufficient data fallback
  // -------------------------------------------------------------------------
  it('Test 13: should automatically apply BASELINE_EXPLORATION when sample size < 5', async () => {
    vi.spyOn(growthMetricsService, 'getAccountLearningSummary').mockResolvedValue({
      total_posts_analyzed: 3, // N < 5
      median_views: 100,
      mean_views: 120,
      views_distribution: { p25: 80, p50: 100, p75: 140, p90: 180 },
      median_reach: 150,
      mean_reach: 160,
      reach_distribution: { p25: 120, p50: 150, p75: 180, p90: 200 },
      median_shares: 5,
      median_saves: 3,
      median_comments: 1,
      median_profile_visits: 2,
      median_follows: 0,
      median_24h_views: 90,
      median_48h_views: 95,
      median_peak_velocity: 50,
      median_time_to_first_observed_view: 40,
      best_performing_category: 'General',
      best_performing_format: 'IMAGE',
      best_observed_window: '19:00 - 20:00',
      best_observed_post_growth_window: '30–60m',
      best_observed_cadence: '60–90m spacing',
      evidence_count: 3,
      confidence: 'LOW',
      disclaimer: 'Observed sample.',
    });

    const rec = await growthSchedulingAgent.getNextSchedulingRecommendation();
    expect(rec.strategy).toBe('BASELINE_EXPLORATION');
    expect(rec.confidence).toBe('LOW');
    expect(rec.exploration.enabled).toBe(true);
    expect(rec.reason).toContain('insufficient');
  });

  // -------------------------------------------------------------------------
  // Test 14: Schedule validation against daily caps and past timestamps
  // -------------------------------------------------------------------------
  it('Test 14: should adjust timestamps that violate past boundaries or daily limits', async () => {
    const pastRecommendation: GroqSchedulingRecommendation = {
      strategy: 'PAST_TIME_TEST',
      recommended_format: 'IMAGE',
      recommended_publish_window: { start: '10:00', end: '11:00' },
      recommended_gap_minutes: { min: 45, max: 75 },
      recommended_posts_per_3h: 1,
      recommended_next_publish_at: '2020-01-01T10:00:00.000Z', // Long in the past!
      wait_before_publishing_minutes: 60,
      confidence: 'LOW',
      evidence_count: 5,
      reason: 'Testing past recovery',
      alternative: { format: 'CAROUSEL', window: '12:00 - 13:00' },
      exploration: { enabled: true, percentage: 20 },
    };

    const validated = await scheduleValidationService.validateAndApplySafetyRules(pastRecommendation);
    expect(validated.valid).toBe(true);
    expect(validated.status).toBe('ADJUSTED_FOR_SAFETY');
    // Adjusted timestamp must be in the future
    expect(new Date(validated.targetTimestamp).getTime()).toBeGreaterThan(Date.now());
  });

  // -------------------------------------------------------------------------
  // Test 15: Stale queue repair
  // -------------------------------------------------------------------------
  it('Test 15: should repair stale or collided scheduled confessions with safe monotonic spacing', async () => {
    const pastIso = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const mockConfessions: Partial<Confession>[] = [
      { id: 'stale-1', google_sheet_row: 10, status: 'SCHEDULED', scheduled_at: pastIso },
      { id: 'stale-2', google_sheet_row: 11, status: 'SCHEDULED', scheduled_at: pastIso },
    ];

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions as Confession[]);
    const updateSpy = vi.spyOn(mockStore, 'updateConfession').mockImplementation(() => null as any);

    const repair = await scheduleValidationService.repairStaleQueue();
    expect(repair.repairedCount).toBe(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 16: Manual override tracking
  // -------------------------------------------------------------------------
  it('Test 16: should track manual user overrides with reason logging for learning accountability', async () => {
    const mockRecord = {
      id: 'rec-test-1',
      status: 'PENDING' as const,
      notes: undefined,
    };

    vi.spyOn(growthStore, 'updateRecommendationRecord').mockResolvedValue({
      ...mockRecord,
      status: 'OVERRIDDEN',
      notes: 'Overridden: Breaking news confession',
    } as any);

    const result = await recommendationLearningService.overrideRecommendation('rec-test-1', {
      format: 'REEL',
      reason: 'Breaking news confession',
    });

    expect(result).toBeDefined();
    expect(result?.status).toBe('OVERRIDDEN');
    expect(result?.notes).toContain('Breaking news confession');
  });

  // -------------------------------------------------------------------------
  // Test 17: Experiment override
  // -------------------------------------------------------------------------
  it('Test 17: should override format when an active controlled experiment is running', async () => {
    const dummyConfession: Partial<Confession> = {
      id: 'conf-exp-1',
      google_sheet_row: 25,
      status: 'APPROVED',
      cleaned_text: 'Experiment test confession',
    };

    const activeExp: PostingExperiment = {
      id: 'exp-format-test',
      name: 'Format Experiment',
      hypothesis: 'Reels outperform images',
      factor: 'CONTENT_FORMAT',
      variants: [
        { id: 'A', name: 'Static Image', description: 'Control', config: { format_type: 'IMAGE' } },
        { id: 'B', name: 'Animated Reel', description: 'Treatment', config: { format_type: 'REEL' } },
      ],
      status: 'ACTIVE',
      sample_size: 2,
      confidence_status: 'PRELIMINARY',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([activeExp]);
    vi.spyOn(experimentService, 'assignToExperiment').mockResolvedValue({
      id: 'asg-1',
      experiment_id: 'exp-format-test',
      variant_id: 'B',
      content_id: 'conf-exp-1',
      assigned_at: new Date().toISOString(),
      confounders: {},
    });

    const recommendation: GroqSchedulingRecommendation = {
      strategy: 'BASELINE',
      recommended_format: 'IMAGE', // Recommendation chose IMAGE
      recommended_publish_window: { start: '19:00', end: '20:00' },
      recommended_gap_minutes: { min: 45, max: 75 },
      recommended_posts_per_3h: 1,
      recommended_next_publish_at: new Date(Date.now() + 3600000).toISOString(),
      wait_before_publishing_minutes: 60,
      confidence: 'MEDIUM',
      evidence_count: 10,
      reason: 'Standard schedule',
      alternative: { format: 'CAROUSEL', window: '20:00 - 21:00' },
      exploration: { enabled: true, percentage: 20 },
    };

    const validated = await scheduleValidationService.validateAndApplySafetyRules(
      recommendation,
      dummyConfession as Confession
    );

    // Experiment assigned variant B which specifies REEL
    expect(validated.targetFormat).toBe('REEL');
    expect(validated.experimentOverride).toBeDefined();
    expect(validated.experimentOverride?.experimentId).toBe('exp-format-test');
    expect(validated.experimentOverride?.variantId).toBe('B');
  });

  // -------------------------------------------------------------------------
  // Test 18: No duplicate scheduling collision
  // -------------------------------------------------------------------------
  it('Test 18: should prevent collision by ensuring spacing when another post is already scheduled', async () => {
    const futureMs = Date.now() + 60 * 60000; // 60 mins from now
    const mockConfessions: Partial<Confession>[] = [
      {
        id: 'scheduled-already',
        status: 'SCHEDULED',
        scheduled_at: new Date(futureMs).toISOString(),
      },
    ];

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions as Confession[]);

    // Recommendation attempts to schedule at the exact same minute
    const collisionRecommendation: GroqSchedulingRecommendation = {
      strategy: 'COLLISION_TEST',
      recommended_format: 'IMAGE',
      recommended_publish_window: { start: '19:00', end: '20:00' },
      recommended_gap_minutes: { min: 45, max: 75 },
      recommended_posts_per_3h: 1,
      recommended_next_publish_at: new Date(futureMs).toISOString(),
      wait_before_publishing_minutes: 60,
      confidence: 'MEDIUM',
      evidence_count: 10,
      reason: 'Attempted same slot',
      alternative: { format: 'CAROUSEL', window: '20:00 - 21:00' },
      exploration: { enabled: true, percentage: 20 },
    };

    const validated = await scheduleValidationService.validateAndApplySafetyRules(
      collisionRecommendation
    );

    expect(validated.status).toBe('ADJUSTED_FOR_SAFETY');
    // Must be spaced at least effectiveCooldown after futureMs
    const targetMs = new Date(validated.targetTimestamp).getTime();
    expect(targetMs).toBeGreaterThanOrEqual(futureMs + validated.cooldownMinutes * 60000);
  });
});
