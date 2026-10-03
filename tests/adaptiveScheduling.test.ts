import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { schedulingService } from '../services/schedulingService';
import { mockStore } from '../lib/mockStore';
import { growthStore } from '../lib/growthStore';
import { confessionService } from '../services/confessionService';
import { Confession } from '../types';
import { MediaPerformanceSnapshot, PublishedMediaItem } from '../types/growth';

describe('Adaptive Growth-Aware Scheduling Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cadenceAnalyzer.invalidateCache();
    schedulingService.resetState();
    vi.spyOn(mockStore, 'getPublishedPosts').mockReturnValue([]);
  });

  afterEach(() => {
    cadenceAnalyzer.invalidateCache();
  });

  // -------------------------------------------------------------
  // Test 1: Baseline Exploration Mode (N < 5)
  // -------------------------------------------------------------
  it('Test 1: should enforce Baseline Exploration mode when historical sample size is insufficient (N < 5)', async () => {
    // Only 2 tracked media items
    const mockMedia: Partial<PublishedMediaItem>[] = [
      { id: 'media-1', instagram_media_id: 'ig-1', post_format: 'IMAGE', caption: 'Post 1' },
      { id: 'media-2', instagram_media_id: 'ig-2', post_format: 'IMAGE', caption: 'Post 2' },
    ];
    const mockSnapshots: Partial<MediaPerformanceSnapshot>[] = [
      { id: 'snap-1', published_media_id: 'media-1', reach: 100, likes: 10 },
      { id: 'snap-2', published_media_id: 'media-2', reach: 150, likes: 15 },
    ];

    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(mockMedia as PublishedMediaItem[]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(mockSnapshots as MediaPerformanceSnapshot[]);
    vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([]);

    const rec = await cadenceAnalyzer.getCadenceRecommendation(true);

    expect(rec.mode).toBe('baseline');
    expect(rec.strategy).toBe('EXPLORATORY_BASELINE');
    expect(rec.supportState).toBe('INSUFFICIENT_DATA');
    expect(rec.confidence).toBe('LOW');
    expect(rec.evidenceCount).toBe(2);
    expect(rec.explorationAllowed).toBe(true);
    expect(rec.reason).toContain('Insufficient historical post data');
    expect(rec.reason).not.toContain('causes');
  });

  // -------------------------------------------------------------
  // Test 2: Growth-Optimized Mode & Sample Size Confidence Gating (N >= 5)
  // -------------------------------------------------------------
  it('Test 2: should transition to Growth-Optimized mode when N >= 5 and scale confidence with sample size', async () => {
    const buildSample = (count: number) => {
      const media: Partial<PublishedMediaItem>[] = [];
      const snapshots: Partial<MediaPerformanceSnapshot>[] = [];
      for (let i = 1; i <= count; i++) {
        media.push({
          id: `media-${i}`,
          instagram_media_id: `ig-${i}`,
          post_format: i % 2 === 0 ? 'CAROUSEL' : 'IMAGE',
          caption: `Post ${i}`,
          published_at: new Date(Date.now() - (count - i) * 60 * 60 * 1000).toISOString(),
        });
        snapshots.push({
          id: `snap-${i}`,
          published_media_id: `media-${i}`,
          reach: 200 + i * 20,
          likes: 20 + i,
          saved: 5,
          shares: 2,
          raw_metric_status: { reach: 'AVAILABLE', likes: 'AVAILABLE', saved: 'AVAILABLE', shares: 'AVAILABLE' } as any,
          collected_at: new Date().toISOString(),
        });
      }
      return { media, snapshots };
    };

    // Subtest A: N = 7 (PRELIMINARY, LOW confidence)
    const sample7 = buildSample(7);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(sample7.media as PublishedMediaItem[]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(sample7.snapshots as MediaPerformanceSnapshot[]);
    vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([]);

    cadenceAnalyzer.invalidateCache();
    const rec7 = await cadenceAnalyzer.getCadenceRecommendation(true);
    expect(rec7.mode).toBe('growth_optimized');
    expect(rec7.supportState).toBe('PRELIMINARY');
    expect(rec7.confidence).toBe('LOW');
    expect(rec7.evidenceCount).toBe(7);

    // Subtest B: N = 12 (PROMISING, MEDIUM confidence)
    const sample12 = buildSample(12);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(sample12.media as PublishedMediaItem[]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(sample12.snapshots as MediaPerformanceSnapshot[]);

    cadenceAnalyzer.invalidateCache();
    const rec12 = await cadenceAnalyzer.getCadenceRecommendation(true);
    expect(rec12.mode).toBe('growth_optimized');
    expect(rec12.supportState).toBe('PROMISING');
    expect(rec12.confidence).toBe('MEDIUM');
    expect(rec12.evidenceCount).toBe(12);

    // Subtest C: N = 22 (SUPPORTED, HIGH confidence)
    const sample22 = buildSample(22);
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(sample22.media as PublishedMediaItem[]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(sample22.snapshots as MediaPerformanceSnapshot[]);

    cadenceAnalyzer.invalidateCache();
    const rec22 = await cadenceAnalyzer.getCadenceRecommendation(true);
    expect(rec22.mode).toBe('growth_optimized');
    expect(rec22.supportState).toBe('SUPPORTED');
    expect(rec22.confidence).toBe('HIGH');
    expect(rec22.evidenceCount).toBe(22);
    expect(rec22.explorationAllowed).toBe(false);
  });

  // -------------------------------------------------------------
  // Test 3: Controlled Jitter Inside Bounds (No Hardcoded 53m)
  // -------------------------------------------------------------
  it('Test 3: should roll dynamic intervals strictly within evidence bounds without hardcoding fixed gaps', async () => {
    const mockRec: any = {
      id: 'rec-test',
      strategy: 'BALANCED_CADENCE',
      mode: 'growth_optimized',
      recommendedGapRangeMinutes: { min: 45, max: 80 },
      reason: 'Observed sample had higher median reach with 45–80m spacing',
    };

    const rolledValues: number[] = [];
    for (let i = 0; i < 50; i++) {
      const res = cadenceAnalyzer.calculateEffectiveGap(mockRec);
      expect(res.rolledGap).toBeGreaterThanOrEqual(45);
      expect(res.rolledGap).toBeLessThanOrEqual(80);
      rolledValues.push(res.rolledGap);
    }

    // Verify values vary and are not all equal to 53 or any single constant
    const uniqueValues = new Set(rolledValues);
    expect(uniqueValues.size).toBeGreaterThan(1);
    expect(rolledValues.some((v) => v !== 53)).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 4: Format-Aware Cadence Rules
  // -------------------------------------------------------------
  it('Test 4: should adjust interval recommendations based on post format (REEL vs IMAGE vs CAROUSEL)', async () => {
    const mockRec: any = {
      id: 'rec-fmt',
      strategy: 'BALANCED_CADENCE',
      mode: 'growth_optimized',
      recommendedGapRangeMinutes: { min: 40, max: 70 },
      formatCadenceMap: {
        REEL: { minGap: 90, maxGap: 180, reason: 'Reels benefit from extended algorithmic indexing time' },
        CAROUSEL: { minGap: 45, maxGap: 80, reason: 'Carousel multi-card reading cadence' },
      },
      reason: 'General cadence',
    };

    const reelGap = cadenceAnalyzer.calculateEffectiveGap(mockRec, 'REEL');
    expect(reelGap.min).toBe(90);
    expect(reelGap.max).toBe(180);
    expect(reelGap.rolledGap).toBeGreaterThanOrEqual(90);
    expect(reelGap.rolledGap).toBeLessThanOrEqual(180);
    expect(reelGap.reason).toContain('Reels benefit');

    const imageGap = cadenceAnalyzer.calculateEffectiveGap(mockRec, 'IMAGE');
    expect(imageGap.min).toBe(40);
    expect(imageGap.max).toBe(70);
  });

  // -------------------------------------------------------------
  // Test 5: Safe Active Daytime Hours & Overnight Rollover
  // -------------------------------------------------------------
  it('Test 5: should align scheduled timestamps to active daytime hours (9 AM - 10 PM) and rest overnight', () => {
    const settings: any = {
      timezone: 'Asia/Kolkata',
      auto_publish_start_hour: 9,
      end_hour: 22,
      auto_publish_end_hour: 22,
    };

    // Case A: Night-time (23:30 Asia/Kolkata = 18:00 UTC) -> should advance to tomorrow 09:00 Asia/Kolkata (03:30 UTC)
    // 2026-10-03 18:00:00 UTC is 23:30:00 in Asia/Kolkata
    const nightDate = new Date('2026-10-03T18:00:00.000Z');
    const alignedNight = schedulingService.alignToActiveHours(nightDate, settings);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    expect(formatter.format(alignedNight)).toBe('09:00');
    expect(alignedNight.getTime()).toBeGreaterThan(nightDate.getTime());

    // Case B: Early Morning (06:15 Asia/Kolkata = 00:45 UTC) -> should advance to today 09:00 Asia/Kolkata
    const earlyMorningDate = new Date('2026-10-04T00:45:00.000Z');
    const alignedMorning = schedulingService.alignToActiveHours(earlyMorningDate, settings);
    expect(formatter.format(alignedMorning)).toBe('09:00');

    // Case C: Normal Daytime (14:30 Asia/Kolkata = 09:00 UTC) -> should remain at 14:30
    // Ensure candidate is in future so nowMs check doesn't advance it
    const futureDaytime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const daytimeHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(futureDaytime),
      10
    );
    if (daytimeHour >= 9 && daytimeHour < 22) {
      const alignedDaytime = schedulingService.alignToActiveHours(futureDaytime, settings);
      expect(alignedDaytime.getTime()).toBe(futureDaytime.getTime());
    }
  });

  // -------------------------------------------------------------
  // Test 6: Stale Queue Repair
  // -------------------------------------------------------------
  it('Test 6: should reschedule past items starting from now using current cadence without arbitrary shifts', async () => {
    const pastTime1 = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    const pastTime2 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago

    const mockConfessions: Confession[] = [
      {
        id: 'conf-stale-1',
        google_sheet_row: 10,
        status: 'SCHEDULED',
        scheduled_at: pastTime1,
        cleaned_text: 'Stale post 1',
        original_text: 'Stale post 1',
        name: 'Anon',
        display_name: 'Anon',
        is_anonymous: true,
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: 'Caption 1',
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
      },
      {
        id: 'conf-stale-2',
        google_sheet_row: 11,
        status: 'SCHEDULED',
        scheduled_at: pastTime2,
        cleaned_text: 'Stale post 2',
        original_text: 'Stale post 2',
        name: 'Anon',
        display_name: 'Anon',
        is_anonymous: true,
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: 'Caption 2',
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
      },
    ];

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions);
    vi.spyOn(mockStore, 'getConfessionById').mockImplementation((id) => mockConfessions.find((c) => c.id === id) || null);
    const updateSpy = vi.spyOn(confessionService, 'updateConfession').mockImplementation(async (id, updates) => {
      const target = mockConfessions.find((c) => c.id === id)!;
      Object.assign(target, updates);
      return target;
    });

    const repairResult = await schedulingService.repairStaleQueue();

    expect(repairResult.repairedCount).toBe(2);
    expect(repairResult.repairedConfessions.length).toBe(2);

    const post1 = mockConfessions.find((c) => c.id === 'conf-stale-1')!;
    const post2 = mockConfessions.find((c) => c.id === 'conf-stale-2')!;

    // Both must be scheduled in the future now
    expect(new Date(post1.scheduled_at!).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(post2.scheduled_at!).getTime()).toBeGreaterThan(Date.now());

    // FIFO ordering must be preserved: post 1 must be scheduled before post 2
    expect(new Date(post1.scheduled_at!).getTime()).toBeLessThan(new Date(post2.scheduled_at!).getTime());

    // Updates must include strategy metadata
    expect(post1.scheduling_strategy).toBeTruthy();
    expect(post1.scheduling_gap_minutes).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------
  // Test 7: Schedule Persistence (No Flapping on Page Reload)
  // -------------------------------------------------------------
  it('Test 7: should preserve valid future scheduled timestamps when generating schedule without forceRecalculate', async () => {
    const existingFutureTimestamp = new Date(Date.now() + 90 * 60 * 1000).toISOString(); // 1.5h in future

    const mockConfessions: Confession[] = [
      {
        id: 'conf-future-1',
        google_sheet_row: 20,
        status: 'SCHEDULED',
        scheduled_at: existingFutureTimestamp,
        cleaned_text: 'Already scheduled future post',
        original_text: 'Already scheduled future post',
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
      },
      {
        id: 'conf-approved-new',
        google_sheet_row: 21,
        status: 'APPROVED',
        scheduled_at: null,
        cleaned_text: 'Newly approved post needing slot',
        original_text: 'Newly approved post needing slot',
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
      },
    ];

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(mockConfessions);
    vi.spyOn(confessionService, 'updateConfession').mockImplementation(async (id, updates) => {
      const target = mockConfessions.find((c) => c.id === id)!;
      Object.assign(target, updates);
      return target;
    });

    const result = await schedulingService.generateFutureSchedule({ preserveExistingFuture: true });

    expect(result.preservedCount).toBe(1);
    expect(result.newlyScheduledCount).toBe(1);

    const post1 = mockConfessions.find((c) => c.id === 'conf-future-1')!;
    const post2 = mockConfessions.find((c) => c.id === 'conf-approved-new')!;

    // Post 1's timestamp was not changed
    expect(post1.scheduled_at).toBe(existingFutureTimestamp);

    // Post 2 received a slot scheduled after post 1
    expect(post2.scheduled_at).toBeTruthy();
    expect(new Date(post2.scheduled_at!).getTime()).toBeGreaterThan(new Date(existingFutureTimestamp).getTime());
  });

  // -------------------------------------------------------------
  // Test 8: Daily Post Cap Enforcement (max_daily_posts)
  // -------------------------------------------------------------
  it('Test 8: should push posts to subsequent calendar days when daily post cap is exceeded', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      max_daily_posts: 3,
      timezone: 'Asia/Kolkata',
      auto_publish_start_hour: 9,
      auto_publish_end_hour: 22,
    });

    const mockConfessions: Confession[] = [];
    for (let i = 1; i <= 6; i++) {
      mockConfessions.push({
        id: `conf-cap-${i}`,
        google_sheet_row: i,
        status: 'APPROVED',
        scheduled_at: null,
        cleaned_text: `Post #${i}`,
        original_text: `Post #${i}`,
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

    const result = await schedulingService.generateFutureSchedule({ forceRecalculate: true });

    expect(result.newlyScheduledCount).toBe(6);

    // Group scheduled items by calendar date in Asia/Kolkata
    const dateCounts = new Map<string, number>();
    for (const item of mockConfessions) {
      const day = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(item.scheduled_at!));
      dateCounts.set(day, (dateCounts.get(day) || 0) + 1);
    }

    // No single day should have more than 3 posts!
    for (const [day, count] of dateCounts.entries()) {
      expect(count).toBeLessThanOrEqual(3);
    }

    // Since there are 6 posts and max is 3/day, they should span at least 2 distinct calendar days
    expect(dateCounts.size).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------
  // Test 9: Admin Manual Override Mode
  // -------------------------------------------------------------
  it('Test 9: should strictly respect Admin Manual Override mode with fixed interval', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      scheduling_strategy_mode: 'MANUAL',
      manual_fixed_gap_minutes: 45,
    });

    cadenceAnalyzer.invalidateCache();
    const rec = await cadenceAnalyzer.getCadenceRecommendation(true);

    expect(rec.strategy).toBe('ADMIN_OVERRIDE');
    expect(rec.mode).toBe('manual');
    expect(rec.recommendedGapRangeMinutes.min).toBe(45);
    expect(rec.recommendedGapRangeMinutes.max).toBe(45);
    expect(rec.reason).toContain('Admin override active');
    expect(rec.explorationAllowed).toBe(false);
  });

  // -------------------------------------------------------------
  // Test 10: Strict Non-Causal Epistemological Phrasing
  // -------------------------------------------------------------
  it('Test 10: should never assert causal claims in strategy reasoning and adhere to observational phrasing', async () => {
    // Generate recommendation with N >= 5
    const media: Partial<PublishedMediaItem>[] = [];
    const snapshots: Partial<MediaPerformanceSnapshot>[] = [];
    for (let i = 1; i <= 8; i++) {
      media.push({
        id: `media-${i}`,
        instagram_media_id: `ig-${i}`,
        post_format: 'IMAGE',
        caption: `Post ${i}`,
        published_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      });
      snapshots.push({
        id: `snap-${i}`,
        published_media_id: `media-${i}`,
        reach: 500,
        likes: 50,
      });
    }

    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(media as PublishedMediaItem[]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(snapshots as MediaPerformanceSnapshot[]);
    vi.spyOn(growthStore, 'getExperiments').mockResolvedValue([]);

    cadenceAnalyzer.invalidateCache();
    const rec = await cadenceAnalyzer.getCadenceRecommendation(true);

    // Epistemological safety checks:
    // 1. Must never assert causation
    expect(rec.reason).not.toMatch(/\bcauses\b/i);
    expect(rec.reason).not.toMatch(/\bguarantees\b/i);
    expect(rec.reason).not.toMatch(/\bwill boost\b/i);

    // 2. Must contain observational framing
    expect(rec.reason).toMatch(/observed|sample|correlated|preliminary|historical/i);
  });

  // -------------------------------------------------------------
  // Test 11: Fault Isolation (Publishing Safety Guarantee)
  // -------------------------------------------------------------
  it('Test 11: should ensure publishing cycle executes safely even if cadence analyzer throws', async () => {
    // Force cadenceAnalyzer to throw
    vi.spyOn(cadenceAnalyzer, 'getCadenceRecommendation').mockRejectedValue(
      new Error('Catastrophic Cadence Engine Failure')
    );

    const candidate: Confession = {
      id: 'conf-safe-publish',
      google_sheet_row: 99,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      cleaned_text: 'Safe confession during analyzer fault',
      original_text: 'Safe confession during analyzer fault',
      name: 'Student',
      display_name: 'Student',
      is_anonymous: false,
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: 'https://test.com/card.png',
      generated_image_path: '/cards/test.png',
      caption: 'Caption',
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      google_sheet_id: 'sheet-1',
      google_sheet_name: 'Sheet1',
    };

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([candidate]);
    vi.spyOn(mockStore, 'getConfessionById').mockReturnValue(candidate);
    vi.spyOn(confessionService, 'updateConfession').mockResolvedValue(candidate);
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      ...mockStore.getSettings(),
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
    });
    vi.spyOn(confessionService, 'publishConfession').mockResolvedValue({
      ...candidate,
      status: 'PUBLISHED',
      instagram_permalink: 'https://instagram.com/p/fault_safe/',
      instagram_media_id: 'ig-safe-123',
    });

    const result = await schedulingService.processAutoPublishCycle(true);

    expect(result.ran).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.instagramPermalink).toBe('https://instagram.com/p/fault_safe/');
  });
});
