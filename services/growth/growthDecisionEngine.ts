/**
 * ConfessionFlow - Growth Decision Engine 3.0
 * Closed-loop decision engine that directs what, when, how often, and when to wait.
 *
 * Integrates the 7 Growth Intelligence Engines:
 * 1. Content Intelligence (Quality scoring & candidate ranking)
 * 2. Timing Intelligence (Optimal hourly and category windows)
 * 3. Gap Intelligence (Learned spacing ranges)
 * 4. Frequency Intelligence (Empirical saturation knee points)
 * 5. Real-Time Post Intelligence (Percentile-based viral velocity monitoring)
 * 6. Content Mix Intelligence (Category post share vs reach share balance)
 * 7. Format Intelligence (Text-length based format optimization)
 */

import { mockStore } from '@/lib/mockStore';
import { Confession, SystemSettings } from '@/types';
import {
  GrowthDecision,
  GrowthDecisionType,
  RealtimePostStatus,
  MediaFormatType,
  ConfidenceLevel,
  AuthoritySource,
  DailyGrowthPlan,
  ContentMixStrategy,
  FormatRecommendationByLength,
} from '@/types/growth';
import { cadenceAnalyzer } from './cadenceAnalyzer';
import { growthMetricsService } from './growthMetricsService';
import { postSaturationService } from './postSaturationService';
import { contentScoringService } from './contentScoringService';
import { growthStrategyValidator } from './growthStrategyValidator';
import { validatePublishEligibility } from '../quality/publishEligibilityService';

export class GrowthDecisionEngine {
  private cachedDecision: GrowthDecision | null = null;
  private cacheExpiresAtMs: number = 0;

  /**
   * Invalidate cached decision
   */
  public invalidateCache(): void {
    this.cachedDecision = null;
    this.cacheExpiresAtMs = 0;
  }

  /**
   * Primary entry point: Get today's holistic growth decision
   */
  public async getTodayGrowthDecision(forceFresh: boolean = false): Promise<GrowthDecision> {
    const nowMs = Date.now();
    if (!forceFresh && this.cachedDecision && nowMs < this.cacheExpiresAtMs) {
      return this.cachedDecision;
    }

    const decision = await this.evaluateNextPost();
    this.cachedDecision = decision;
    // Cache for 3 minutes to keep UI snappy while staying fresh
    this.cacheExpiresAtMs = nowMs + 3 * 60 * 1000;
    return decision;
  }

  /**
   * Evaluate next post decision incorporating all 7 intelligence engines
   */
  public async evaluateNextPost(candidateOverride?: Confession): Promise<GrowthDecision> {
    const settings = mockStore.getSettings();
    const now = new Date();

    // 1. Frequency & Daily Plan Intelligence
    const dailyPlan = await cadenceAnalyzer.generateDailyGrowthPlan(now);

    // 2. Real-Time Post Velocity & Percentile Intelligence
    const realtimeStatus = await postSaturationService.getRealtimePostStatus();

    // 3. Content Mix & Format Intelligence
    const contentMix = await growthMetricsService.getContentMixStrategy();
    const formatRecs = await growthMetricsService.getFormatRecommendationByLength();

    // Calculate published count for today in account timezone
    const tz = settings.timezone || 'Asia/Kolkata';
    const todayKey = growthMetricsService.getDateKeyInAccountTz(now, tz);
    const confessions = mockStore.getConfessions();
    const publishedTodayCount = confessions.filter((c) => {
      if (c.status !== 'PUBLISHED' || !c.published_at) return false;
      return growthMetricsService.getDateKeyInAccountTz(c.published_at, tz) === todayKey;
    }).length;

    // 4. Candidate Retrieval & Content Quality Intelligence
    let candidate: Confession | null = candidateOverride || null;
    let selectedFormat: MediaFormatType = 'IMAGE';

    const minQuality = settings.content_quality_threshold ?? 55;
    const isAutoPublishMode = settings.publishing_mode === 'AUTO_PUBLISH' || settings.auto_publish;

    if (!candidate) {
      const eligible = confessions.filter((c) => {
        if (
          c.status !== 'APPROVED' &&
          !(isAutoPublishMode && c.status === 'READY_FOR_REVIEW') &&
          !(c.status === 'SCHEDULED' && !c.published_at && !c.instagram_media_id)
        ) {
          return false;
        }
        if (c.instagram_media_id || c.published_at) return false;
        return validatePublishEligibility(c, settings).isEligible;
      });

      if (eligible.length > 0) {
        // Rank candidates using predicted score & aging fairness
        const ranked = await contentScoringService.rankCandidates(eligible, minQuality);
        if (ranked.length > 0) {
          // Favor category recommendations from Content Mix if score difference is slight (<= 3 pts)
          const boostedCandidate = this.selectWithContentMixAffinity(ranked, contentMix);
          candidate = boostedCandidate.confession;
          candidate.predicted_performance_score = boostedCandidate.predictedPerformanceScore;
        } else {
          // Candidates exist but failed quality threshold!
          candidate = eligible[0]; // Retain top candidate for review
        }
      }
    }

    // Determine optimal format based on candidate word count
    if (candidate) {
      const text = candidate.cleaned_text || candidate.original_text || '';
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 100) {
        selectedFormat = 'CAROUSEL';
      } else if (wordCount < 40) {
        selectedFormat = 'IMAGE';
      } else {
        selectedFormat = dailyPlan.preferred_formats[0] || 'IMAGE';
      }
    }

    // 5. Synthesize Decision & Action Type
    let decisionType: GrowthDecisionType = 'POST_NOW';
    let nextPublishTimeIso = now.toISOString();
    let effectiveGap = dailyPlan.recommended_spacing.min_minutes;

    // Check 1: Real-time velocity hold
    if (realtimeStatus.has_active_post && realtimeStatus.should_hold_next_post) {
      decisionType = 'WAIT';
      const waitMinutes = Math.max(15, realtimeStatus.hold_duration_minutes_recommended);
      effectiveGap = waitMinutes;
      nextPublishTimeIso = new Date(now.getTime() + waitMinutes * 60000).toISOString();
    }
    // Check 2: Daily volume limit reached
    else if (publishedTodayCount >= dailyPlan.effective_daily_posts) {
      decisionType = 'WAIT';
      // Post tomorrow morning at active start hour
      const tomorrow = new Date(now.getTime() + 24 * 3600000);
      tomorrow.setHours(settings.auto_publish_start_hour ?? 9, 0, 0, 0);
      nextPublishTimeIso = tomorrow.toISOString();
    }
    // Check 3: No candidates available
    else if (!candidate) {
      decisionType = 'NO_QUALIFIED_CONTENT';
    }
    // Check 4: Candidate exists but below quality threshold
    else if (
      typeof candidate.predicted_performance_score === 'number' &&
      candidate.predicted_performance_score < minQuality
    ) {
      decisionType = 'HOLD_CONTENT';
    }
    // Check 5: Timing window & normal spacing
    else {
      // Check last published post timing for minimum spacing
      const lastPubMs = realtimeStatus.published_at ? new Date(realtimeStatus.published_at).getTime() : 0;
      const elapsedSinceLastPubMinutes = lastPubMs > 0 ? Math.floor((now.getTime() - lastPubMs) / 60000) : 9999;

      if (elapsedSinceLastPubMinutes < dailyPlan.recommended_spacing.min_minutes) {
        decisionType = 'SCHEDULE';
        const remainingMinutes = dailyPlan.recommended_spacing.min_minutes - elapsedSinceLastPubMinutes;
        effectiveGap = dailyPlan.recommended_spacing.min_minutes;
        nextPublishTimeIso = new Date(now.getTime() + remainingMinutes * 60000).toISOString();
      } else {
        decisionType = 'POST_NOW';
      }
    }

    // 6. Build Comprehensive Empirical Rationale ("WHY")
    const rationale = this.buildEmpiricalRationale({
      decisionType,
      candidate,
      selectedFormat,
      dailyPlan,
      publishedTodayCount,
      realtimeStatus,
      contentMix,
      formatRecs,
    });

    const confidenceLevel: ConfidenceLevel =
      dailyPlan.confidence >= 0.75 ? 'HIGH' : dailyPlan.confidence >= 0.40 ? 'MEDIUM' : 'LOW';

    const rawDecision: GrowthDecision = {
      id: `decision-${Date.now()}`,
      decision: decisionType,
      candidate,
      candidate_id: candidate?.id || null,
      candidate_row: candidate?.google_sheet_row || null,
      recommended_format: selectedFormat,
      recommended_time: nextPublishTimeIso,
      recommended_gap_minutes: effectiveGap,
      current_post_status: realtimeStatus.has_active_post ? realtimeStatus : null,
      authority_source: dailyPlan.authority_source,
      confidence: confidenceLevel,
      confidence_score: dailyPlan.confidence,
      rationale,
      daily_strategy: {
        recommended_daily_posts: dailyPlan.recommended_posts,
        effective_daily_posts: dailyPlan.effective_daily_posts,
        min_gap_minutes: dailyPlan.recommended_spacing.min_minutes,
        max_gap_minutes: dailyPlan.recommended_spacing.max_minutes,
        saturation_detected: dailyPlan.saturation_detected,
        knee_point: dailyPlan.saturation_knee_posts_per_day,
      },
      timestamp: now.toISOString(),
    };

    // 7. Validate through GrowthStrategyValidator
    const validation = growthStrategyValidator.validateDecision(rawDecision, settings);
    if (!validation.isValid && validation.adjustedDecision) {
      rawDecision.decision = validation.adjustedDecision;
      if (validation.adjustedGapMinutes) rawDecision.recommended_gap_minutes = validation.adjustedGapMinutes;
      if (validation.adjustedDailyPosts) {
        rawDecision.daily_strategy.effective_daily_posts = validation.adjustedDailyPosts;
      }
      rawDecision.authority_source = validation.authoritySource;
    }

    return rawDecision;
  }

  /**
   * Helper: Select top candidate with affinity for under-represented high-efficiency categories
   */
  private selectWithContentMixAffinity(
    ranked: Array<{ confession: Confession; predictedPerformanceScore: number }>,
    mix: ContentMixStrategy[]
  ): { confession: Confession; predictedPerformanceScore: number } {
    if (ranked.length <= 1 || mix.length === 0) return ranked[0];

    const topScore = ranked[0].predictedPerformanceScore;
    const candidatesWithinBuffer = ranked.filter((r) => topScore - r.predictedPerformanceScore <= 3);

    const highEfficiencyCategories = new Set(
      mix.filter((m) => m.recommendation === 'INCREASE').map((m) => m.category.toLowerCase())
    );

    const preferred = candidatesWithinBuffer.find((c) => {
      const cat = (c.confession.google_sheet_name || '').toLowerCase();
      return highEfficiencyCategories.has(cat);
    });

    return preferred || ranked[0];
  }

  /**
   * Construct transparent empirical factors for the "WHY" panel
   */
  private buildEmpiricalRationale(params: {
    decisionType: GrowthDecisionType;
    candidate: Confession | null;
    selectedFormat: MediaFormatType;
    dailyPlan: DailyGrowthPlan;
    publishedTodayCount: number;
    realtimeStatus: RealtimePostStatus;
    contentMix: ContentMixStrategy[];
    formatRecs: FormatRecommendationByLength[];
  }): {
    summary: string;
    factors: {
      frequency: string;
      timing: string;
      gap: string;
      real_time_velocity: string;
      format: string;
      content_mix: string;
      content_quality: string;
    };
    evidence_count: number;
  } {
    const {
      decisionType,
      candidate,
      selectedFormat,
      dailyPlan,
      publishedTodayCount,
      realtimeStatus,
      contentMix,
    } = params;

    // Frequency factor
    const frequencyReason = dailyPlan.saturation_detected
      ? `Saturation knee observed at ~${dailyPlan.saturation_knee_posts_per_day} posts/day. Capping daily volume at ${dailyPlan.effective_daily_posts} posts/day to prevent reach dilution.`
      : `Optimal frequency is ${dailyPlan.effective_daily_posts} posts/day (${publishedTodayCount}/${dailyPlan.effective_daily_posts} published today).`;

    // Real-time velocity factor
    let velocityReason = 'Previous post has reached maturity or reached normal observation threshold.';
    if (realtimeStatus.has_active_post) {
      if (realtimeStatus.is_accelerating) {
        velocityReason = `🔥 Active post #${realtimeStatus.confession_row ?? 'recent'} is outperforming historical baseline (${realtimeStatus.views_velocity_per_hour} views/hr, ${realtimeStatus.historical_percentile}th percentile). Waiting ${realtimeStatus.hold_duration_minutes_recommended}m to protect viral growth.`;
      } else if (realtimeStatus.is_plateaued) {
        velocityReason = `Active post #${realtimeStatus.confession_row ?? 'recent'} has matured (${realtimeStatus.views_velocity_per_hour} views/hr, ${realtimeStatus.historical_percentile}th percentile). No evidence waiting longer improves performance.`;
      }
    }

    // Gap factor
    const gapReason = `Recommended spacing is ${dailyPlan.recommended_spacing.min_minutes}–${dailyPlan.recommended_spacing.max_minutes}m based on account retention curves.`;

    // Format factor
    const wordCount = candidate
      ? (candidate.cleaned_text || candidate.original_text || '').trim().split(/\s+/).filter(Boolean).length
      : 0;
    const formatReason =
      selectedFormat === 'CAROUSEL'
        ? `Confession has ${wordCount} words (>100 words). Formatted as a multi-slide Carousel to maximize swipe dwell time and prevent tiny illegible text.`
        : `Confession has ${wordCount} words (<100 words). Formatted as a Single Card for instant readability.`;

    // Content mix factor
    const topCategory = contentMix.find((m) => m.recommendation === 'INCREASE');
    const contentMixReason = topCategory
      ? `Category "${topCategory.category}" is punching above its weight (${topCategory.historical_reach_share_pct}% reach from ${topCategory.historical_post_share_pct}% posts, efficiency: ${topCategory.efficiency_ratio}x). Prioritizing high-performing categories.`
      : 'Content category distribution is balanced with historical reach.';

    // Quality factor
    const qualityReason = candidate
      ? `Candidate #${candidate.google_sheet_row} scored ${candidate.predicted_performance_score ?? 'N/A'}/100 across emotional resonance, hook strength, and discussion potential.`
      : 'No qualified content meeting quality threshold.';

    // Timing factor
    const timingReason =
      dailyPlan.preferred_windows.length > 0
        ? `Target windows: ${dailyPlan.preferred_windows.map((w) => `${w.start}–${w.end}`).join(', ')}.`
        : 'Publishing across standard daytime hours.';

    let summary = '';
    if (decisionType === 'WAIT') {
      summary = realtimeStatus.is_accelerating
        ? `WAIT: Current post is outperforming historical baseline (${realtimeStatus.historical_percentile}th percentile). Holding next post to allow viral distribution.`
        : `WAIT: Daily post limit (${dailyPlan.effective_daily_posts}/day) reached. Resting account until next active window.`;
    } else if (decisionType === 'POST_NOW') {
      summary = `POST NOW: Next confession #${candidate?.google_sheet_row ?? ''} is verified, meets quality standards, and cadence window is clear.`;
    } else if (decisionType === 'SCHEDULE') {
      summary = `SCHEDULE: Post queued for next optimal slot (${params.dailyPlan.recommended_spacing.min_minutes}m spacing).`;
    } else if (decisionType === 'HOLD_CONTENT') {
      summary = `HOLD CONTENT: Available candidates fall below the quality threshold. Waiting for higher-grade confessions.`;
    } else {
      summary = `NO QUALIFIED CONTENT: Queue has no approved confessions ready for publishing.`;
    }

    return {
      summary,
      factors: {
        frequency: frequencyReason,
        timing: timingReason,
        gap: gapReason,
        real_time_velocity: velocityReason,
        format: formatReason,
        content_mix: contentMixReason,
        content_quality: qualityReason,
      },
      evidence_count: dailyPlan.sample_size,
    };
  }
}

export const growthDecisionEngine = new GrowthDecisionEngine();
