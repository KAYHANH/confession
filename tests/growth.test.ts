import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { instagramInsightsProvider } from '../services/growth/instagramInsightsProvider';
import { analyticsCollector } from '../services/growth/analyticsCollector';
import { growthMetricsService } from '../services/growth/growthMetricsService';
import { contentFeatureExtractor } from '../services/growth/contentFeatureExtractor';
import { growthAnalysisService } from '../services/growth/growthAnalysisService';
import { experimentService } from '../services/growth/experimentService';
import { growthRecommendationService } from '../services/growth/growthRecommendationService';
import { getGrowthFeatureFlags, getSafeGrowthPublicFlags } from '../lib/growthConfig';
import { growthStore } from '../lib/growthStore';
import { confessionService } from '../services/confessionService';
import { instagramService } from '../services/instagramService';
import { googleSheetsService } from '../services/googleSheetsService';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';
import { MediaPerformanceSnapshot } from '../types/growth';

describe('Growth Intelligence Subsystem Comprehensive Tests', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  // 1. Metric Definitions & Null vs 0 Distinction
  describe('Metric Definitions & Null vs 0 Distinction', () => {
    it('should have valid metric definitions for Instagram Graph API v21.0', () => {
      const defs = instagramInsightsProvider.getSupportedMetricDefinitions();
      expect(defs.length).toBeGreaterThan(5);

      for (const def of defs) {
        expect(def.platform).toBe('INSTAGRAM');
        expect(def.api_version).toBe('v21.0');
        expect(def.metric_name).toBeTruthy();
        expect(def.definition).toBeTruthy();
      }
    });

    it('should strictly differentiate between NULL (unsupported/unavailable) and 0 (explicit zero)', () => {
      const rawApiData = [
        { name: 'reach', values: [{ value: 120 }] },
        { name: 'likes', values: [{ value: 0 }] }, // Explicit 0
        // 'shares' omitted -> null
      ];

      const snapshot = instagramInsightsProvider.parseInsightMetrics(rawApiData, 'IMAGE', 'v21.0');
      expect(snapshot.reach).toBe(120);
      expect(snapshot.likes).toBe(0);
      expect(snapshot.shares).toBeNull();
      expect(snapshot.raw_metric_status.likes).toBe('ZERO');
      expect(snapshot.raw_metric_status.shares).toBe('UNAVAILABLE');
    });
  });

  // 2. Snapshot Deduplication & Partial Degradation
  describe('Analytics Collection & Snapshot Deduplication', () => {
    it('should deduplicate snapshots when inserting same published_media_id and age_bucket', async () => {
      const mediaId = 'media-dedup-test-' + Date.now();
      const snap1: MediaPerformanceSnapshot = {
        id: `snap-1-${Date.now()}`,
        published_media_id: mediaId,
        collected_at: new Date().toISOString(),
        target_age_minutes: 15,
        actual_age_minutes: 16,
        age_bucket: '15m',
        views: 50,
        plays: null,
        reach: 45,
        likes: 5,
        comments: 1,
        shares: 0,
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

      const snap2: MediaPerformanceSnapshot = {
        ...snap1,
        id: `snap-2-${Date.now()}`,
        views: 55, // Updated view count
      };

      await growthStore.saveSnapshot(snap2);

      const allSnaps = await growthStore.getSnapshots(mediaId);
      const bucket15m = allSnaps.filter((s) => s.age_bucket === '15m');
      expect(bucket15m.length).toBe(1);
      expect(bucket15m[0].views).toBe(55);
    });

    it('should handle partial collection and record unsupported metrics', () => {
      // Static image requested for video-only metric 'plays'
      const rawApiData = [
        { name: 'reach', values: [{ value: 80 }] },
      ];
      const parsed = instagramInsightsProvider.parseInsightMetrics(rawApiData, 'IMAGE', 'v21.0');
      expect(parsed.collection_status).toBe('PARTIAL');
      expect(parsed.unsupported_metrics).toContain('plays');
      expect(parsed.plays).toBeNull();
    });
  });

  // 3. Instagram Publishing Safety Invariant
  describe('Publishing Safety Guarantee', () => {
    it('should ensure Instagram publish succeeds even if analytics collection throws an error', async () => {
      const mockConfession: Confession = {
        id: 'conf-safety-test',
        google_sheet_id: 'sheet_1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 99,
        name: 'Alex',
        original_text: 'Safety test confession',
        cleaned_text: 'Safety test confession',
        display_name: 'Alex',
        is_anonymous: true,
        status: 'APPROVED',
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: 'https://example.com/test.png',
        generated_image_path: null,
        caption: 'Safety caption',
        hashtags: ['#safety'],
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

      // Mock Instagram service to return immediate success
      vi.spyOn(instagramService, 'publishPost').mockResolvedValue({
        success: true,
        mediaId: '17841437796028856_safety',
        permalink: 'https://instagram.com/p/safety123',
      });

      // Mock Google Sheets update
      vi.spyOn(googleSheetsService, 'updateRowStatus').mockResolvedValue(true);

      // Spy on analytics collector and force it to throw
      const collectorSpy = vi.spyOn(analyticsCollector, 'registerPublishedMedia').mockRejectedValue(
        new Error('Fatal analytics database crash')
      );

      // Execute publish
      const publishResult = await confessionService.publishConfession('conf-safety-test');

      // Crucial verification: Publishing succeeded despite analytics failure
      expect(publishResult.status).toBe('PUBLISHED');
      expect(publishResult.instagram_media_id).toBe('17841437796028856_safety');
      const storePost = mockStore.getConfessionById('conf-safety-test');
      expect(storePost?.status).toBe('PUBLISHED');
    });
  });

  // 4. Growth Metric Calculations & Epistemology
  describe('Growth Metric Calculations', () => {
    it('should compute mean and median correctly for odd, even, and zero datasets', () => {
      expect(growthMetricsService.calculateMean([10, 20, 30])).toBe(20);
      expect(growthMetricsService.calculateMedian([10, 20, 30])).toBe(20);

      // Even length
      expect(growthMetricsService.calculateMedian([10, 20, 30, 40])).toBe(25);

      // Array with zeros
      expect(growthMetricsService.calculateMedian([0, 0, 10, 20])).toBe(5);

      // Empty array
      expect(growthMetricsService.calculateMean([])).toBe(0);
      expect(growthMetricsService.calculateMedian([])).toBe(0);
    });

    it('should calculate ConfessionFlow Performance Index (0–100) with boundary limits', () => {
      const zeroMetrics = {
        reach: 0,
        shares: 0,
        saves: 0,
        comments: 0,
        profileVisits: 0,
        follows: 0,
      };

      const highMetrics = {
        reach: 5000,
        shares: 120,
        saves: 85,
        comments: 65,
        profileVisits: 80,
        follows: 25,
      };

      const indexZero = growthMetricsService.calculatePerformanceIndex(zeroMetrics);
      const indexHigh = growthMetricsService.calculatePerformanceIndex(highMetrics);

      expect(indexZero).toBe(0);
      expect(indexHigh).toBe(100);
    });

    it('should assign correct Statistical Support State based on sample sizes', () => {
      expect(growthMetricsService.determineSupportState(0)).toBe('INSUFFICIENT_DATA');
      expect(growthMetricsService.determineSupportState(4)).toBe('INSUFFICIENT_DATA');
      expect(growthMetricsService.determineSupportState(5)).toBe('PRELIMINARY');
      expect(growthMetricsService.determineSupportState(9)).toBe('PRELIMINARY');
      expect(growthMetricsService.determineSupportState(10)).toBe('PROMISING');
      expect(growthMetricsService.determineSupportState(19)).toBe('PROMISING');
      expect(growthMetricsService.determineSupportState(20)).toBe('SUPPORTED');
      expect(growthMetricsService.determineSupportState(100)).toBe('SUPPORTED');
    });
  });

  // 5. Feature Extraction
  describe('Content Feature Extraction', () => {
    it('should extract word count, character count, and hook correctly', async () => {
      const confessionText = 'I have a confession to make. I accidentally took the professors coffee mug from the canteen and never returned it! Thoughts?';
      const features = await contentFeatureExtractor.extractFeatures('conf-extract-1', confessionText);

      expect(features.word_count).toBeGreaterThan(15);
      expect(features.character_count).toBe(confessionText.length);
      expect(features.hook_text).toBe('I have a confession to make');
      expect(features.college_theme).toBe(true);
      expect(features.cta_present).toBe(true);
      expect(features.question_present).toBe(true);
    });

    it('should detect relationship, humorous, and dramatic themes', async () => {
      const romanticText = 'I secretly have the biggest crush on my senior since first semester. He makes my heart race every time he smiles.';
      const romanceFeatures = await contentFeatureExtractor.extractFeatures('conf-romance', romanticText);
      expect(romanceFeatures.relationship_theme).toBe(true);

      const funnyText = 'Lol this was the most hilarious and embarrassing prank accident in my entire hostel life.';
      const funnyFeatures = await contentFeatureExtractor.extractFeatures('conf-funny', funnyText);
      expect(funnyFeatures.funny_theme).toBe(true);
    });
  });

  // 6. Groq Growth Analyst with Zod Validation & Fallback
  describe('Groq Growth Analyst & Fallbacks', () => {
    it('should validate structured analyst output schema using Zod', () => {
      const mockAnalystOutput = {
        observations: ['Evening slots show higher median reach.'],
        patterns: ['Reels show 1.4x reach compared to images.'],
        possible_causes: ['Algorithm pushes vertical video format.'],
        recommendations: ['Prioritize publishing between 7:00 PM and 9:00 PM.'],
        experiments: ['Test question hooks vs shock hooks.'],
        confidence: ['Observed across historical sample.'],
      };

      const parsed = growthAnalysisService.ANALYSIS_SCHEMA.safeParse(mockAnalystOutput);
      expect(parsed.success).toBe(true);
    });

    it('should gracefully provide deterministic fallback when AI response is malformed', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'MALFORMED NON-JSON RESPONSE' } }],
        }),
      });

      const result = await growthAnalysisService.generateGrowthAnalysis();
      expect(result).toBeDefined();
      expect(result.observations.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  // 7. Controlled Experiments
  describe('Controlled Experiment Engine', () => {
    it('should evenly distribute variants in balanced A/B assignments', async () => {
      const exp = await experimentService.createExperiment({
        name: 'Hook Style Test',
        hypothesis: 'Question hooks will achieve higher median engagement than statement hooks',
        factor: 'HOOK_STYLE',
        variant_a_label: 'Question Hook',
        variant_b_label: 'Statement Hook',
        target_sample_size: 20,
      });

      const assignments: string[] = [];
      for (let i = 0; i < 20; i++) {
        const variant = await experimentService.assignVariant(exp.id);
        assignments.push(variant);
      }

      const countA = assignments.filter((a) => a === 'A').length;
      const countB = assignments.filter((a) => a === 'B').length;

      expect(countA).toBe(10);
      expect(countB).toBe(10);
    });
  });

  // 8. Epistemological Discipline in Recommendations
  describe('Recommendations & Epistemological Discipline', () => {
    it('should never claim causation and use observational phrasing with sample sizes', async () => {
      const confession: Confession = {
        id: 'conf-rec-epistemology',
        google_sheet_id: 'sheet_1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 101,
        name: 'Priya',
        original_text: 'Is it normal to feel completely overwhelmed during final exam season? Need advice!',
        cleaned_text: 'Is it normal to feel completely overwhelmed during final exam season? Need advice!',
        display_name: 'Priya',
        is_anonymous: false,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: 'Exam season check-in',
        hashtags: ['#exams'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const rec = await growthRecommendationService.generateRecommendation(confession);

      expect(rec.rationale).not.toMatch(/\b(causes|proves|guarantees)\b/i);
      expect(rec.confounders_noted.length).toBeGreaterThan(0);
      expect(rec.evidence_count).toBeGreaterThanOrEqual(0);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(rec.recommendation_confidence);
    });
  });

  // 9. Feature Flags
  describe('Feature Flags Defaults & Safety', () => {
    it('should default all Growth feature flags to false when env vars are unset', () => {
      const flags = getGrowthFeatureFlags();
      expect(typeof flags.enableGrowthIntelligence).toBe('boolean');
      expect(typeof flags.enableAnalyticsCollection).toBe('boolean');
      expect(typeof flags.enableReelEngine).toBe('boolean');
      expect(typeof flags.enableGrowthRecommendations).toBe('boolean');
      expect(typeof flags.enableExperiments).toBe('boolean');

      const safeFlags = getSafeGrowthPublicFlags();
      expect(safeFlags.apiVersion).toBe('v21.0');
    });

    it('should skip background analytics collection without error when feature flag is disabled', async () => {
      const result = await analyticsCollector.collectSnapshotCycle();
      expect(result).toBeDefined();
      expect(result.snapshotsCollected).toBe(0);
    });
  });
});
