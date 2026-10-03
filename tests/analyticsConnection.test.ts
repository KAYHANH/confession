import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { instagramInsightsProvider } from '../services/growth/instagramInsightsProvider';
import { instagramService } from '../services/instagramService';
import { analyticsCollector } from '../services/growth/analyticsCollector';
import { growthMetricsService } from '../services/growth/growthMetricsService';
import { growthStore } from '../lib/growthStore';
import { mockStore } from '../lib/mockStore';
import { confessionService } from '../services/confessionService';
import { googleSheetsService } from '../services/googleSheetsService';
import { POST as cronHandler } from '../app/api/cron/instagram-analytics/route';
import { Confession } from '../types';
import { PublishedMedia, MediaPerformanceSnapshot } from '../types/growth';

describe('Task 18: Growth Intelligence Analytics Connection & Scheduling Tests', () => {
  const origFetch = global.fetch;
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
  });

  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...origEnv };
  });

  // =========================================================================
  // Test 1: Valid publishing token
  // =========================================================================
  it('Test 1: should verify valid publishing token and report connected status in diagnostics', async () => {
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_valid_test_token';

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: '17841437796028856',
            user_id: '17841437796028856',
            username: '_hpsconfession_',
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const diagnostics = await instagramService.getDiagnostics({ testAnalytics: false });
    expect(diagnostics.connected).toBe(true);
    expect(diagnostics.instagramUserId).toBe('17841437796028856');
    expect(diagnostics.username).toBe('_hpsconfession_');
    expect(diagnostics.publishingPermissionAvailable).toBe(true);
  });

  // =========================================================================
  // Test 2: Valid analytics permission
  // =========================================================================
  it('Test 2: should verify valid analytics permission when Meta Insights returns data', async () => {
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_valid_insights_token';

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      // 1. Account media lookup
      if (url.includes('/media?') || url.includes('/media&')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: '18135970810629089', media_type: 'IMAGE' }],
          }),
        };
      }
      // 2. Post metadata lookup (likes/comments)
      if (url.includes('/18135970810629089?fields=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: '18135970810629089',
            like_count: 42,
            comments_count: 5,
            media_type: 'IMAGE',
          }),
        };
      }
      // 3. Post insights lookup
      if (url.includes('/insights?metric=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { name: 'views', values: [{ value: 1471 }] },
              { name: 'reach', values: [{ value: 535 }] },
              { name: 'saved', values: [{ value: 12 }] },
              { name: 'shares', values: [{ value: 7 }] },
              { name: 'total_interactions', values: [{ value: 66 }] },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const result = await instagramInsightsProvider.testAnalyticsPermission('18135970810629089');
    expect(result.connected).toBe(true);
    expect(result.available).toBe(true);
    expect(result.sampleMetrics).toBeDefined();
    expect(result.sampleMetrics?.views).toBe(1471);
    expect(result.sampleMetrics?.reach).toBe(535);
    expect(result.sampleMetrics?.likes).toBe(42);
    expect(result.sampleMetrics?.shares).toBe(7);
  });

  // =========================================================================
  // Test 3: Missing analytics permission
  // =========================================================================
  it('Test 3: should detect missing analytics permission (Error 200/10) and provide guidance', async () => {
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_missing_permission_token';

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/insights?metric=')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: {
              message: 'Requires instagram_business_manage_insights permission to access media insights.',
              type: 'OAuthException',
              code: 200,
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '18135970810629089',
          like_count: 0,
          comments_count: 0,
        }),
      };
    });

    const result = await instagramInsightsProvider.testAnalyticsPermission('18135970810629089');
    expect(result.connected).toBe(true);
    expect(result.available).toBe(false);
    expect(result.errorCode).toBe('MISSING_INSIGHTS_PERMISSION');
    expect(result.errorMessage).toContain('instagram_business_manage_insights');
  });

  // =========================================================================
  // Test 4: Missing access token
  // =========================================================================
  it('Test 4: should handle missing access token gracefully without crashing', async () => {
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    vi.spyOn(mockStore, 'getInstagramConfig').mockReturnValue({
      account_id: '17841437796028856',
      access_token: '',
      username: '_hpsconfession_',
      connected: false,
      page_id: '',
    });

    const diag = await instagramService.getDiagnostics();
    expect(diag.connected).toBe(false);
    expect(diag.errorCode).toBe('MISSING_ACCESS_TOKEN');

    const permTest = await instagramInsightsProvider.testAnalyticsPermission();
    expect(permTest.connected).toBe(false);
    expect(permTest.available).toBe(false);
    expect(permTest.errorCode).toBe('MISSING_ACCESS_TOKEN');
  });

  // =========================================================================
  // Test 5: Missing account ID
  // =========================================================================
  it('Test 5: should handle missing account ID gracefully without crashing', async () => {
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_valid_token';
    delete process.env.INSTAGRAM_ACCOUNT_ID;
    vi.spyOn(mockStore, 'getInstagramConfig').mockReturnValue({
      account_id: '',
      access_token: 'IGAA_valid_token',
      username: '',
      connected: false,
      page_id: '',
    });

    const diag = await instagramService.getDiagnostics();
    expect(diag.connected).toBe(false);
    expect(diag.errorCode).toBe('MISSING_ACCOUNT_ID');

    const permTest = await instagramInsightsProvider.testAnalyticsPermission();
    expect(permTest.connected).toBe(false);
    expect(permTest.available).toBe(false);
    expect(permTest.errorCode).toBe('MISSING_ACCOUNT_ID');
  });

  // =========================================================================
  // Test 6: No published media
  // =========================================================================
  it('Test 6: should handle 0 published media gracefully and report NO_DATA', async () => {
    // Mock growthStore to return 0 published media
    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue([]);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue([]);

    const cycleResult = await analyticsCollector.runCollectionCycle();
    expect(cycleResult.checked).toBe(0);
    expect(cycleResult.snapshotsCollected).toBe(0);

    const overview = await growthMetricsService.getAccountOverview(30);
    expect(overview.total_published).toBe(0);
    expect(overview.posts_with_snapshots).toBe(0);
    expect(overview.data_status).toBe('NO_DATA');
    expect(overview.data_availability).toBe('NO_PUBLISHED_POSTS');
  });

  // =========================================================================
  // Test 7: Published media with no snapshots
  // =========================================================================
  it('Test 7: should report NO_DATA / NO_SNAPSHOTS when media exists but snapshots are 0', async () => {
    const mockMedia: PublishedMedia[] = [
      {
        id: 'pub-test-no-snap-1',
        confession_id: 'conf-1',
        platform_media_id: 'media_ig_111',
        permalink: 'https://instagram.com/p/111',
        format_type: 'IMAGE',
        published_at: new Date(Date.now() - 3600000).toISOString(),
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'pub-test-no-snap-2',
        confession_id: 'conf-2',
        platform_media_id: 'media_ig_222',
        permalink: 'https://instagram.com/p/222',
        format_type: 'IMAGE',
        published_at: new Date(Date.now() - 7200000).toISOString(),
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(growthStore, 'getPublishedMedia').mockResolvedValue(mockMedia);
    vi.spyOn(growthStore, 'getSnapshots').mockResolvedValue([]);

    const overview = await growthMetricsService.getAccountOverview(30);
    expect(overview.total_published).toBe(2);
    expect(overview.posts_with_snapshots).toBe(0);
    expect(overview.total_snapshots).toBe(0);
    expect(overview.data_status).toBe('NO_DATA');
    expect(overview.data_availability).toBe('NO_SNAPSHOTS');
    expect(overview.mean_reach).toBe(0);
    expect(overview.average_engagement_rate).toBe(0);
  });

  // =========================================================================
  // Test 8: Successful media insights
  // =========================================================================
  it('Test 8: should successfully fetch and parse media insights into snapshot structure', async () => {
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_test_token';
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/18135970810629089?fields=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: '18135970810629089',
            like_count: 4,
            comments_count: 1,
            media_type: 'IMAGE',
          }),
        };
      }
      if (url.includes('/insights?metric=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { name: 'views', values: [{ value: 1471 }] },
              { name: 'reach', values: [{ value: 535 }] },
              { name: 'saved', values: [{ value: 0 }] },
              { name: 'shares', values: [{ value: 2 }] },
              { name: 'total_interactions', values: [{ value: 6 }] },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const insights = await instagramInsightsProvider.getMediaInsights('18135970810629089', 'IMAGE');
    expect(insights.views).toBe(1471);
    expect(insights.reach).toBe(535);
    expect(insights.likes).toBe(4);
    expect(insights.comments).toBe(1);
    expect(insights.saves).toBe(0);
    expect(insights.shares).toBe(2);
    expect(insights.collectionStatus).toBe('SUCCESS');
    expect(insights.rawMetricStatus['views']).toBe('AVAILABLE');
    expect(insights.rawMetricStatus['saved']).toBe('ZERO'); // Distinguishes explicit 0
  });

  // =========================================================================
  // Test 9: Unsupported metric stored as NULL (not 0)
  // =========================================================================
  it('Test 9: should store unsupported metrics as NULL (not 0) and flag UNAVAILABLE', () => {
    const rawApiData = [
      { name: 'reach', values: [{ value: 500 }] },
      { name: 'saved', values: [{ value: 0 }] }, // Explicit 0
      // 'shares' and 'plays' omitted
    ];

    const parsed = instagramInsightsProvider.parseInsightMetrics(rawApiData, 'IMAGE', 'v21.0');

    // Explicit 0 must be 0
    expect(parsed.saves).toBe(0);
    expect(parsed.raw_metric_status['saved']).toBe('ZERO');

    // Unsupported/missing metrics must be NULL, never 0
    expect(parsed.shares).toBeNull();
    expect(parsed.plays).toBeNull();
    expect(parsed.raw_metric_status['shares']).toBe('UNAVAILABLE');
    expect(parsed.raw_metric_status['plays']).toBe('UNAVAILABLE');
    expect(parsed.unsupported_metrics).toContain('plays');
  });

  // =========================================================================
  // Test 10: Meta API failure handled gracefully
  // =========================================================================
  it('Test 10: should isolate Meta API 500 error gracefully without crashing collector', async () => {
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_test_token';
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: {
            message: 'Internal Meta Graph API server error',
            code: 1,
            type: 'OAuthException',
          },
        }),
      };
    });

    const insights = await instagramInsightsProvider.getMediaInsights('faulty_media_123', 'IMAGE');
    expect(insights.collectionStatus).toBe('PARTIAL');
    expect(insights.errorMessage).toBeTruthy();
    expect(insights.views).toBeNull();
    expect(insights.reach).toBeNull();
  });

  // =========================================================================
  // Test 11: Duplicate snapshot attempt (deduplication)
  // =========================================================================
  it('Test 11: should deduplicate snapshots for the same published_media_id and age_bucket', async () => {
    const mediaId = 'media-dedup-run-' + Date.now();
    const snap1: MediaPerformanceSnapshot = {
      id: `snap-init-${Date.now()}`,
      published_media_id: mediaId,
      collected_at: new Date().toISOString(),
      target_age_minutes: 15,
      actual_age_minutes: 15,
      age_bucket: '15m',
      views: 100,
      plays: null,
      reach: 80,
      likes: 10,
      comments: 2,
      shares: 1,
      saves: 0,
      profile_visits: null,
      follows: null,
      total_watch_time_ms: null,
      average_watch_time_ms: null,
      replays: null,
      followers_reached: null,
      non_followers_reached: null,
      raw_metric_status: {},
      api_version: 'v21.0',
      collection_status: 'SUCCESS',
      unsupported_metrics: [],
      created_at: new Date().toISOString(),
    };

    await growthStore.saveSnapshot(snap1);

    // Insert updated duplicate for the same bucket
    const snap2: MediaPerformanceSnapshot = {
      ...snap1,
      id: `snap-update-${Date.now()}`,
      views: 150,
      reach: 120,
    };

    await growthStore.saveSnapshot(snap2);

    const snapshots = await growthStore.getSnapshotsForMedia(mediaId);
    // Should be exactly 1 snapshot for 15m bucket with updated values
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].age_bucket).toBe('15m');
    expect(snapshots[0].views).toBe(150);
    expect(snapshots[0].reach).toBe(120);
  });

  // =========================================================================
  // Test 12: Cron authentication failure (401)
  // =========================================================================
  it('Test 12: should reject cron invocation with 401 when CRON_SECRET is missing or wrong', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-token-12345';
    process.env.NODE_ENV = 'production';

    // 1. Missing header
    const reqNoAuth = new NextRequest('http://localhost:3000/api/cron/instagram-analytics', {
      method: 'POST',
    });
    const resNoAuth = await cronHandler(reqNoAuth);
    expect(resNoAuth.status).toBe(401);
    const dataNoAuth = await resNoAuth.json();
    expect(dataNoAuth.error).toBe('Unauthorized');

    // 2. Wrong secret
    const reqWrongAuth = new NextRequest('http://localhost:3000/api/cron/instagram-analytics', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret-token',
      },
    });
    const resWrongAuth = await cronHandler(reqWrongAuth);
    expect(resWrongAuth.status).toBe(401);
    const dataWrongAuth = await resWrongAuth.json();
    expect(dataWrongAuth.error).toBe('Unauthorized');
  });

  // =========================================================================
  // Test 13: Cron successful run (200 with checked and snapshotsCollected)
  // =========================================================================
  it('Test 13: should succeed with 200 and return checked counts when cron is properly authorized', async () => {
    process.env.CRON_SECRET = 'valid-super-cron-secret-32-chars';
    process.env.ENABLE_ANALYTICS_COLLECTION = 'true';
    process.env.ENABLE_GROWTH_INTELLIGENCE = 'true';

    vi.spyOn(analyticsCollector, 'runCollectionCycle').mockResolvedValue({
      checked: 5,
      snapshotsCollected: 2,
    });

    const req = new NextRequest('http://localhost:3000/api/cron/instagram-analytics', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-super-cron-secret-32-chars',
      },
    });

    const res = await cronHandler(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('SUCCESS');
    expect(data.checked).toBe(5);
    expect(data.snapshotsCollected).toBe(2);
    expect(data.timestamp).toBeDefined();
  });

  // =========================================================================
  // Test 14: Analytics failure does not affect publishing
  // =========================================================================
  it('Test 14: should guarantee that Instagram publishing succeeds even if analytics registration fails', async () => {
    const mockConfession: Confession = {
      id: 'conf-resilience-publish-test',
      google_sheet_id: 'sheet_pub_test',
      google_sheet_name: 'Confessions',
      google_sheet_row: 105,
      name: 'Resilience Test',
      original_text: 'Publishing safety guarantee test text',
      cleaned_text: 'Publishing safety guarantee test text',
      display_name: 'Resilience Test',
      is_anonymous: true,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: 'tpl-1',
      generated_image_url: 'https://example.com/resilience.png',
      generated_image_path: null,
      caption: 'Publishing resilience caption',
      hashtags: ['#resilience'],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockStore.addConfession(mockConfession);

    // Mock Instagram publish to succeed
    vi.spyOn(instagramService, 'publishPost').mockResolvedValue({
      success: true,
      mediaId: '17841437796028856_resilient',
      permalink: 'https://instagram.com/p/resilient999',
    });

    // Mock Google Sheet status update to succeed
    vi.spyOn(googleSheetsService, 'updateRowStatus').mockResolvedValue(true);

    // Force analytics registration to crash
    vi.spyOn(analyticsCollector, 'registerPublishedMedia').mockRejectedValue(
      new Error('Severe analytics database outage')
    );

    const publishResult = await confessionService.publishConfession('conf-resilience-publish-test');

    // Publishing must succeed completely despite analytics crash
    expect(publishResult.status).toBe('PUBLISHED');
    expect(publishResult.instagram_media_id).toBe('17841437796028856_resilient');
    expect(publishResult.instagram_permalink).toBe('https://instagram.com/p/resilient999');

    // Store state must be PUBLISHED
    const updatedPost = mockStore.getConfessionById('conf-resilience-publish-test');
    expect(updatedPost?.status).toBe('PUBLISHED');
  });
});
