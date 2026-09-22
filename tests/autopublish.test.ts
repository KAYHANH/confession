import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schedulingService } from '../services/schedulingService';
import { mockStore } from '../lib/mockStore';
import { confessionService } from '../services/confessionService';
import { Confession } from '../types';

describe('24/7 Autonomous Auto-Publish Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: should skip auto-publishing when auto_publish is false and mode is MANUAL_APPROVAL', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      brand_name: 'Test',
      instagram_handle: '@test',
      logo_url: '/logo.png',
      default_template_id: 'tpl-1',
      timezone: 'Asia/Kolkata',
      auto_publish: false,
      publishing_mode: 'MANUAL_APPROVAL',
      default_publishing_time: '19:30',
      max_daily_posts: 10,
      enable_profanity_filter: true,
      enable_pii_detection: true,
      require_approval: true,
      risk_threshold: 'LOW',
      default_hashtags: ['#test'],
    });

    const result = await schedulingService.processAutoPublishCycle();
    expect(result.ran).toBe(false);
    expect(result.status).toBe('SKIPPED');
  });

  it('Test 2: should block auto-publishing when daily post cap is reached', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      brand_name: 'Test',
      instagram_handle: '@test',
      logo_url: '/logo.png',
      default_template_id: 'tpl-1',
      timezone: 'Asia/Kolkata',
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      default_publishing_time: '19:30',
      max_daily_posts: 5,
      enable_profanity_filter: true,
      enable_pii_detection: true,
      require_approval: true,
      risk_threshold: 'LOW',
      default_hashtags: ['#test'],
    });

    vi.spyOn(confessionService, 'getDashboardStats').mockResolvedValue({
      total: 100,
      pendingReview: 10,
      approved: 5,
      scheduled: 0,
      published: 85,
      rejected: 0,
      failed: 0,
      publishedToday: 5,
      maxDailyPosts: 5,
    });

    const result = await schedulingService.processAutoPublishCycle();
    expect(result.ran).toBe(false);
    expect(result.status).toBe('DAILY_LIMIT_REACHED');
  });

  it('Test 3: should enforce post spacing cooldown between successive automated posts', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      brand_name: 'Test',
      instagram_handle: '@test',
      logo_url: '/logo.png',
      default_template_id: 'tpl-1',
      timezone: 'Asia/Kolkata',
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      default_publishing_time: '19:30',
      max_daily_posts: 10,
      auto_publish_interval_minutes: 60,
      auto_publish_start_hour: 0,
      auto_publish_end_hour: 24,
      enable_profanity_filter: true,
      enable_pii_detection: true,
      require_approval: true,
      risk_threshold: 'LOW',
      default_hashtags: ['#test'],
    });

    vi.spyOn(confessionService, 'getDashboardStats').mockResolvedValue({
      total: 10,
      pendingReview: 5,
      approved: 2,
      scheduled: 0,
      published: 3,
      rejected: 0,
      failed: 0,
      publishedToday: 1,
      maxDailyPosts: 10,
    });

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([
      {
        id: 'conf-published-1',
        google_sheet_id: 'sheet_1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 1,
        name: 'Anonymous',
        original_text: 'Recent post',
        cleaned_text: 'Recent post',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'PUBLISHED',
        moderation_status: 'LOW',
        moderation_reason: 'Passed',
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: 'https://example.com/img.png',
        generated_image_path: null,
        caption: 'Cap',
        hashtags: ['#test'],
        scheduled_at: null,
        published_at: tenMinutesAgo,
        instagram_media_id: '12345',
        instagram_permalink: 'https://instagram.com/p/12345',
        retry_count: 0,
        error_message: null,
        created_at: tenMinutesAgo,
        updated_at: tenMinutesAgo,
      },
    ]);

    const result = await schedulingService.processAutoPublishCycle();
    expect(result.ran).toBe(false);
    expect(result.status).toBe('RATE_LIMITED');
    expect(result.reason).toContain('cooldown');
  });

  it('Test 4: should never auto-publish HIGH-risk confessions', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      brand_name: 'Test',
      instagram_handle: '@test',
      logo_url: '/logo.png',
      default_template_id: 'tpl-1',
      timezone: 'Asia/Kolkata',
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      default_publishing_time: '19:30',
      max_daily_posts: 10,
      auto_publish_interval_minutes: 60,
      auto_publish_start_hour: 0,
      auto_publish_end_hour: 24,
      enable_profanity_filter: true,
      enable_pii_detection: true,
      require_approval: true,
      risk_threshold: 'LOW',
      default_hashtags: ['#test'],
    });

    vi.spyOn(confessionService, 'getDashboardStats').mockResolvedValue({
      total: 1,
      pendingReview: 1,
      approved: 0,
      scheduled: 0,
      published: 0,
      rejected: 0,
      failed: 0,
      publishedToday: 0,
      maxDailyPosts: 10,
    });

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([
      {
        id: 'conf-high-risk',
        google_sheet_id: 'sheet_1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 2,
        name: 'Anonymous',
        original_text: 'Violent or threatening content',
        cleaned_text: 'Violent or threatening content',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'HIGH',
        moderation_reason: 'Safety policy violation',
        ai_processed: false,
        template_id: 'tpl-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: '',
        hashtags: [],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await schedulingService.processAutoPublishCycle(true);
    expect(result.ran).toBe(false);
    expect(result.status).toBe('NO_CANDIDATES');
  });

  it('Test 5: should successfully auto-process and publish an eligible LOW-risk confession', async () => {
    vi.spyOn(mockStore, 'getSettings').mockReturnValue({
      brand_name: 'Test',
      instagram_handle: '@test',
      logo_url: '/logo.png',
      default_template_id: 'tpl-1',
      timezone: 'Asia/Kolkata',
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      default_publishing_time: '19:30',
      max_daily_posts: 10,
      auto_publish_interval_minutes: 60,
      auto_publish_start_hour: 0,
      auto_publish_end_hour: 24,
      enable_profanity_filter: true,
      enable_pii_detection: true,
      require_approval: true,
      risk_threshold: 'LOW',
      default_hashtags: ['#test'],
    });

    vi.spyOn(confessionService, 'getDashboardStats').mockResolvedValue({
      total: 1,
      pendingReview: 1,
      approved: 0,
      scheduled: 0,
      published: 0,
      rejected: 0,
      failed: 0,
      publishedToday: 0,
      maxDailyPosts: 10,
    });

    const mockCandidate: Confession = {
      id: 'conf-low-risk-1',
      google_sheet_id: 'sheet_1',
      google_sheet_name: 'Confessions',
      google_sheet_row: 10,
      name: 'Priya',
      original_text: 'I love college library',
      cleaned_text: 'I love college library',
      display_name: 'Priya',
      is_anonymous: false,
      status: 'READY_FOR_REVIEW',
      moderation_status: 'LOW',
      moderation_reason: 'Passed safety validation.',
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: 'https://example.com/card.png',
      generated_image_path: null,
      caption: 'Confession #10',
      hashtags: ['#campus'],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(mockStore, 'getConfessions').mockReturnValue([mockCandidate]);
    vi.spyOn(confessionService, 'publishConfession').mockResolvedValue({
      ...mockCandidate,
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      instagram_media_id: 'ig_test_123',
      instagram_permalink: 'https://www.instagram.com/p/test12345/',
    });

    const result = await schedulingService.processAutoPublishCycle(true);
    expect(result.ran).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.publishedConfessionId).toBe('conf-low-risk-1');
    expect(result.confessionNumber).toBe(10);
    expect(result.instagramPermalink).toBe('https://www.instagram.com/p/test12345/');
  });
});
