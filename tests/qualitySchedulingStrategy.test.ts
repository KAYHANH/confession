import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postSaturationService } from '../services/growth/postSaturationService';
import { contentScoringService } from '../services/growth/contentScoringService';
import { schedulingService } from '../services/schedulingService';
import { cadenceAnalyzer } from '../services/growth/cadenceAnalyzer';
import { mockStore } from '../lib/mockStore';
import { growthStore } from '../lib/growthStore';
import { confessionService } from '../services/confessionService';
import { Confession } from '../types';
import { MediaPerformanceSnapshot, PublishedMediaItem } from '../types/growth';

describe('Quality-First Data-Driven Scheduling Strategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cadenceAnalyzer.invalidateCache();
    schedulingService.resetState();
    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([]);
  });

  afterEach(() => {
    cadenceAnalyzer.invalidateCache();
  });

  // -------------------------------------------------------------
  // Test 1: Conservative Volume Defaults
  // -------------------------------------------------------------
  it('Test 1: should enforce conservative volume limits (max 6, target 4, min 2) and QUALITY_FIRST mode by default', () => {
    const settings = mockStore.getSettings();
    expect(settings.max_daily_posts).toBe(6);
    expect(settings.target_daily_posts).toBe(4);
    expect(settings.min_daily_posts).toBe(2);
    expect(settings.scheduling_mode).toBe('QUALITY_FIRST');
    expect(settings.content_quality_threshold).toBe(60);
  });

  // -------------------------------------------------------------
  // Test 2: Post Saturation Service - Accelerating Velocity Hold
  // -------------------------------------------------------------
  it('Test 2: should delay next post when previous post is actively accelerating in growth velocity', async () => {
    const nowMs = Date.now();
    const publishedAt = new Date(nowMs - 45 * 60 * 1000).toISOString();

    const mockMedia: Partial<PublishedMediaItem>[] = [
      {
        id: 'media-viral-1',
        instagram_media_id: 'ig-viral-1',
        content_id: 'conf-viral-1',
        post_format: 'CAROUSEL',
        published_at: publishedAt,
      },
    ];

    const mockSnapshots: Partial<MediaPerformanceSnapshot>[] = [
      {
        id: 'snap-1',
        published_media_id: 'media-viral-1',
        actual_age_minutes: 15,
        views: 100,
        reach: 80,
      },
      {
        id: 'snap-2',
        published_media_id: 'media-viral-1',
        actual_age_minutes: 30,
        views: 200,
        reach: 160,
      },
      {
        id: 'snap-3',
        published_media_id: 'media-viral-1',
        actual_age_minutes: 45,
        views: 450, // Delta 250 in 15m = 1000 views/hr (accelerating from 400 v/hr)
        reach: 380,
      },
    ];

    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(mockMedia as any);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(mockSnapshots as any);

    const sat = await postSaturationService.evaluateSaturation();

    expect(sat.hasRecentPost).toBe(true);
    expect(sat.isAccelerating).toBe(true);
    expect(sat.isPlateaued).toBe(false);
    expect(sat.shouldDelayNextPost).toBe(true);
    expect(sat.recommendedWaitMinutes).toBeGreaterThan(0);
    expect(sat.reason).toContain('actively accelerating');
  });

  // -------------------------------------------------------------
  // Test 3: Post Saturation Service - Plateaued Velocity Release
  // -------------------------------------------------------------
  it('Test 3: should permit next post when previous post velocity has plateaued', async () => {
    const nowMs = Date.now();
    const publishedAt = new Date(nowMs - 90 * 60 * 1000).toISOString();

    const mockMedia: Partial<PublishedMediaItem>[] = [
      {
        id: 'media-plateau-1',
        instagram_media_id: 'ig-plat-1',
        content_id: 'conf-plat-1',
        post_format: 'IMAGE',
        published_at: publishedAt,
      },
    ];

    const mockSnapshots: Partial<MediaPerformanceSnapshot>[] = [
      {
        id: 'snap-1',
        published_media_id: 'media-plateau-1',
        actual_age_minutes: 15,
        views: 100,
        reach: 80,
      },
      {
        id: 'snap-2',
        published_media_id: 'media-plateau-1',
        actual_age_minutes: 30,
        views: 250, // Delta 150 in 15m = 600 views/hr
        reach: 220,
      },
      {
        id: 'snap-3',
        published_media_id: 'media-plateau-1',
        actual_age_minutes: 60,
        views: 270, // Delta 20 in 30m = 40 views/hr (down from 600 v/hr -> plateaued)
        reach: 240,
      },
    ];

    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(mockMedia as any);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue(mockSnapshots as any);

    const sat = await postSaturationService.evaluateSaturation();

    expect(sat.hasRecentPost).toBe(true);
    expect(sat.isAccelerating).toBe(false);
    expect(sat.isPlateaued).toBe(true);
    expect(sat.shouldDelayNextPost).toBe(false);
    expect(sat.postSaturationScore).toBeGreaterThanOrEqual(75);
    expect(sat.reason).toContain('plateaued');
  });

  // -------------------------------------------------------------
  // Test 4: Content Scoring Service - Multidimensional Calculation
  // -------------------------------------------------------------
  it('Test 4: should calculate predicted performance score combining quality, format, hook, and length', async () => {
    const highPotentialConfession: Partial<Confession> = {
      id: 'conf-score-1',
      google_sheet_row: 101,
      name: 'Tester',
      display_name: 'Tester',
      original_text: 'I never told anyone this before, but I secretly studied all night to surprise my sister with her dream tuition fund.',
      cleaned_text: 'I never told anyone this before, but I secretly studied all night to surprise my sister with her dream tuition fund.',
      quality_score: 90,
      quality_status: 'HIGH_VALUE',
      format: 'CAROUSEL',
      slides: [{ slide_index: 0, text: 'Part 1' }, { slide_index: 1, text: 'Part 2' }],
      created_at: new Date().toISOString(),
    };

    const scored = await contentScoringService.scoreConfession(highPotentialConfession as Confession);

    expect(scored.predictedPerformanceScore).toBeGreaterThanOrEqual(75);
    expect(scored.factors.baseQuality).toBe(90);
    expect(scored.factors.formatBonus).toBe(85); // CAROUSEL
    expect(scored.factors.hookStrength).toBe(90); // Shock/Curiosity hook
    expect(scored.factors.lengthBonus).toBeGreaterThanOrEqual(80);
  });

  // -------------------------------------------------------------
  // Test 5: Anti-Starvation Aging Fairness
  // -------------------------------------------------------------
  it('Test 5: should apply aging boost to prevent older approved submissions from being permanently starved', async () => {
    const now = Date.now();

    // Candidate A: 12 hours old, base quality 70
    const olderCandidate: Partial<Confession> = {
      id: 'conf-old-1',
      google_sheet_row: 20,
      name: 'Old Submission',
      display_name: 'Old Submission',
      original_text: 'I really love this college community so much.',
      quality_score: 70,
      created_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
    };

    // Candidate B: brand new (0m old), base quality 72
    const newerCandidate: Partial<Confession> = {
      id: 'conf-new-1',
      google_sheet_row: 50,
      name: 'New Submission',
      display_name: 'New Submission',
      original_text: 'I really love this college community so much.',
      quality_score: 72,
      created_at: new Date(now).toISOString(),
    };

    const ranked = await contentScoringService.rankCandidates([
      newerCandidate as Confession,
      olderCandidate as Confession,
    ]);

    expect(ranked.length).toBe(2);
    // Candidate A waited 12 hours -> receives +18 aging boost points
    const olderRanked = ranked.find((r) => r.confession.id === 'conf-old-1');
    const newerRanked = ranked.find((r) => r.confession.id === 'conf-new-1');

    expect(olderRanked?.agingBoost).toBe(18);
    expect(newerRanked?.agingBoost).toBe(0);
    expect(olderRanked?.effectiveScore).toBeGreaterThan(newerRanked?.effectiveScore || 0);

    // The older candidate must rank #1 because of the fairness aging boost
    expect(ranked[0].confession.id).toBe('conf-old-1');
  });

  // -------------------------------------------------------------
  // Test 6: Scheduler Integration - Assigns why_this_time and predicted score
  // -------------------------------------------------------------
  it('Test 6: should assign why_this_time badge and predicted score during schedule generation', async () => {
    const confessions: Partial<Confession>[] = [
      {
        id: 'conf-sched-1',
        google_sheet_row: 35,
        name: 'Anon',
        display_name: 'Anon',
        original_text: 'Looking back at graduation, everything worked out fine.',
        status: 'APPROVED',
        moderation_status: 'LOW',
        quality_score: 85,
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue(confessions as Confession[]);
    const updateSpy = vi.spyOn(confessionService, 'updateConfession').mockResolvedValue(confessions[0] as Confession);

    const result = await schedulingService.generateFutureSchedule(false, false);

    expect(result.newlyScheduledCount).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(
      'conf-sched-1',
      expect.objectContaining({
        status: 'SCHEDULED',
        why_this_time: expect.stringMatching(/(Growth optimized|Random fallback|Fixed cooldown)/),
      })
    );
  });

  // -------------------------------------------------------------
  // Test 7: Daily Volume Cap Enforcement
  // -------------------------------------------------------------
  it('Test 7: should halt publishing when conservative daily post cap of 6 is reached', async () => {
    mockStore.updateSettings({
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      max_daily_posts: 6,
    });

    vi.spyOn(confessionService, 'getDashboardStats').mockResolvedValue({
      publishedToday: 6,
      maxDailyPosts: 6,
      pendingCount: 10,
      totalCount: 50,
      scheduledCount: 5,
      rejectedCount: 2,
    } as any);

    const result = await schedulingService.processAutoPublishCycle();

    expect(result.ran).toBe(false);
    expect(result.status).toBe('DAILY_LIMIT_REACHED');
    expect(result.reason).toContain('Daily post cap reached (6/6)');
  });
});
