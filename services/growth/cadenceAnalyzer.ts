/**
 * ConfessionFlow - Growth Cadence Analyzer & Strategy Recommender
 * Evaluates historical account-level performance to generate adaptive, evidence-based
 * scheduling strategies, preferred posting windows, and posting frequency limits.
 *
 * Epistemological Rule:
 * Strictly non-causal phrasing. Never states "X causes Y". Always states
 * "In the observed sample (N=...), posts published with X had higher median Y."
 */

import {
  CadenceStrategyType,
  SchedulerRecommendation,
  PreferredPostingWindow,
  MediaFormatType,
  ConfidenceLevel,
  StatisticalSupportState,
  DailyGrowthPlan,
  AuthoritySource,
} from '@/types/growth';
import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';
import { growthMetricsService } from './growthMetricsService';

export class CadenceAnalyzer {
  private cachedRecommendation: SchedulerRecommendation | null = null;
  private cacheExpiresAtMs: number = 0;
  private cachedDailyPlan: DailyGrowthPlan | null = null;
  private dailyPlanCacheExpiresAtMs: number = 0;

  /**
   * Invalidate cached recommendation when new posts or snapshots are registered
   */
  public invalidateCache(): void {
    this.cachedRecommendation = null;
    this.cacheExpiresAtMs = 0;
    this.cachedDailyPlan = null;
    this.dailyPlanCacheExpiresAtMs = 0;
  }

  /**
   * Main entry point: Get current adaptive scheduling recommendation
   */
  public async getCadenceRecommendation(forceFresh: boolean = false): Promise<SchedulerRecommendation> {
    const nowMs = Date.now();
    if (!forceFresh && this.cachedRecommendation && nowMs < this.cacheExpiresAtMs) {
      return this.cachedRecommendation;
    }

    const recommendation = await this.computeCadenceRecommendation();
    this.cachedRecommendation = recommendation;
    // Cache for 15 minutes to prevent re-computation on rapid page reloads
    this.cacheExpiresAtMs = nowMs + 15 * 60 * 1000;
    return recommendation;
  }

  /**
   * Deep analysis of account history to produce evidence-backed cadence recommendations
   */
  private async computeCadenceRecommendation(): Promise<SchedulerRecommendation> {
    const settings = mockStore.getSettings();
    const configMin = Math.max(20, settings.min_gap_minutes ?? 30);
    const configMax = Math.max(configMin + 10, settings.max_gap_minutes ?? 75);

    // 1. Admin Override Check
    const strategyMode = settings.scheduling_strategy_mode || 'AUTO';

    if (strategyMode === 'MANUAL') {
      const manualGap = Math.max(15, settings.manual_fixed_gap_minutes || 60);
      return {
        id: `rec-manual-${Date.now()}`,
        strategy: 'ADMIN_OVERRIDE',
        mode: 'manual',
        recommendedGapRangeMinutes: { min: manualGap, max: manualGap },
        recommendedPostsPerHour: Math.round((60 / manualGap) * 10) / 10,
        recommendedPostsPerThreeHours: Math.max(1, Math.floor(180 / manualGap)),
        cooldownMinutes: Math.round(manualGap * 0.7),
        preferredWindows: [
          {
            start: `${String(settings.auto_publish_start_hour ?? 9).padStart(2, '0')}:00`,
            end: `${String(settings.auto_publish_end_hour ?? 22).padStart(2, '0')}:00`,
            label: 'Configured Active Window',
          },
        ],
        confidence: 'HIGH',
        supportState: 'SUPPORTED',
        evidenceCount: 0,
        reason: `Admin override active: Configured to fixed ${manualGap}m post spacing.`,
        explorationAllowed: false,
        generated_at: new Date().toISOString(),
        version: '1.0.0-manual',
      };
    }

    if (strategyMode === 'BASELINE') {
      return {
        id: `rec-baseline-override-${Date.now()}`,
        strategy: 'EXPLORATORY_BASELINE',
        mode: 'baseline',
        recommendedGapRangeMinutes: { min: configMin, max: configMax },
        recommendedPostsPerHour: Math.round((60 / ((configMin + configMax) / 2)) * 10) / 10,
        recommendedPostsPerThreeHours: Math.max(1, Math.floor(180 / ((configMin + configMax) / 2))),
        cooldownMinutes: Math.round(configMin * 0.75),
        preferredWindows: [
          {
            start: `${String(settings.auto_publish_start_hour ?? 9).padStart(2, '0')}:00`,
            end: `${String(settings.auto_publish_end_hour ?? 22).padStart(2, '0')}:00`,
            label: 'Standard Daytime Hours',
          },
        ],
        confidence: 'LOW',
        supportState: 'INSUFFICIENT_DATA',
        evidenceCount: 0,
        reason: `Admin selected Baseline Exploration mode (${configMin}–${configMax} min gaps).`,
        explorationAllowed: true,
        generated_at: new Date().toISOString(),
        version: '1.0.0-baseline',
      };
    }

    // 2. Active Cadence Experiment Check
    try {
      const experiments = await growthStore.getExperiments();
      const activeCadenceExp = experiments.find(
        (e) => e.status === 'ACTIVE' && (e.factor === 'POST_GAP' || e.factor === 'POSTING_TIME')
      );

      if (activeCadenceExp && settings.enable_experimental_scheduling !== false) {
        return {
          id: `rec-exp-${activeCadenceExp.id}-${Date.now()}`,
          strategy: 'EXPERIMENTAL_CADENCE',
          mode: 'experiment',
          recommendedGapRangeMinutes: { min: configMin, max: configMax },
          recommendedPostsPerHour: 1.0,
          recommendedPostsPerThreeHours: 3,
          cooldownMinutes: 30,
          preferredWindows: [
            {
              start: `${String(settings.auto_publish_start_hour ?? 9).padStart(2, '0')}:00`,
              end: `${String(settings.auto_publish_end_hour ?? 22).padStart(2, '0')}:00`,
              label: 'Experiment Window',
            },
          ],
          confidence: 'MEDIUM',
          supportState: 'PROMISING',
          evidenceCount: activeCadenceExp.sample_size,
          reason: `Active controlled experiment "${activeCadenceExp.name}" is testing cadence variations across variants.`,
          explorationAllowed: true,
          experimentId: activeCadenceExp.id,
          experimentFactor: activeCadenceExp.factor,
          generated_at: new Date().toISOString(),
          version: '1.0.0-experiment',
        };
      }
    } catch {}

    // 3. Historical Data Inspection & Sample Size Gating
    const _mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();

    // Map unique media IDs having at least one snapshot
    const trackedMediaIds = new Set(snapshots.map((s) => s.published_media_id));
    const evidenceCount = trackedMediaIds.size;

    // Epistemological Sample Size Gating:
    // N < 5: INSUFFICIENT_DATA -> Fallback to Baseline Exploration
    if (evidenceCount < 5) {
      return {
        id: `rec-insufficient-${Date.now()}`,
        strategy: 'EXPLORATORY_BASELINE',
        mode: 'baseline',
        recommendedGapRangeMinutes: { min: configMin, max: configMax },
        recommendedPostsPerHour: Math.round((60 / ((configMin + configMax) / 2)) * 10) / 10,
        recommendedPostsPerThreeHours: Math.max(1, Math.floor(180 / ((configMin + configMax) / 2))),
        cooldownMinutes: Math.round(configMin * 0.75),
        preferredWindows: [
          {
            start: `${String(settings.auto_publish_start_hour ?? 9).padStart(2, '0')}:00`,
            end: `${String(settings.auto_publish_end_hour ?? 22).padStart(2, '0')}:00`,
            label: 'Exploratory Daytime Window',
          },
        ],
        confidence: 'LOW',
        supportState: 'INSUFFICIENT_DATA',
        evidenceCount,
        reason: `Insufficient historical post data (${evidenceCount}/5 minimum tracked posts). Using baseline exploration intervals (${configMin}–${configMax}m) to collect initial performance variance.`,
        explorationAllowed: true,
        generated_at: new Date().toISOString(),
        version: '1.0.0-adaptive',
      };
    }

    // Determine statistical confidence level
    let supportState: StatisticalSupportState = 'PRELIMINARY';
    let confidence: ConfidenceLevel = 'LOW';
    if (evidenceCount >= 20) {
      supportState = 'SUPPORTED';
      confidence = 'HIGH';
    } else if (evidenceCount >= 10) {
      supportState = 'PROMISING';
      confidence = 'MEDIUM';
    }

    // 4. Cadence & Gap Analysis
    const gapStats = await growthMetricsService.getPostGapAnalysis();
    const validBuckets = gapStats.filter((g) => g.sample_size > 0);

    // Default gap if no buckets have data
    let chosenMin = 60;
    let chosenMax = 80;
    let strategyReason = `Sufficient baseline data collected across N=${evidenceCount} posts. Using balanced cadence with natural jitter.`;
    let strategy: CadenceStrategyType = 'BALANCED_CADENCE';

    if (validBuckets.length > 0) {
      // Find bucket with highest median reach
      const sortedByReach = [...validBuckets].sort((a, b) => b.median_reach - a.median_reach);
      const bestBucket = sortedByReach[0];

      if (bestBucket && bestBucket.sample_size >= 1) {
        if (bestBucket.gap_bucket === '0-15m' || bestBucket.gap_bucket === '15-30m') {
          chosenMin = 30;
          chosenMax = 45;
          strategy = 'BURST_AND_COOLDOWN';
          strategyReason = `Posts published with tighter spacing (${bestBucket.gap_bucket}) had higher median reach (${bestBucket.median_reach}) in the observed sample (N=${bestBucket.sample_size}). Correlation observed, not causal evidence.`;
        } else if (bestBucket.gap_bucket === '30-60m') {
          chosenMin = 45;
          chosenMax = 65;
          strategy = 'BALANCED_CADENCE';
          strategyReason = `Posts published with 30–60 minute spacing had higher median reach (${bestBucket.median_reach}) in the observed sample (N=${bestBucket.sample_size}). Correlation observed, not causal evidence.`;
        } else if (bestBucket.gap_bucket === '60-120m') {
          chosenMin = 60;
          chosenMax = 80;
          strategy = 'BALANCED_CADENCE';
          strategyReason = `Posts published with 60–120 minute spacing had higher median reach (${bestBucket.median_reach}) in the observed sample (N=${bestBucket.sample_size}). Correlation observed, not causal evidence.`;
        } else if (bestBucket.gap_bucket === '120-240m') {
          chosenMin = 90;
          chosenMax = 120;
          strategy = 'OFF_PEAK_SPACING';
          strategyReason = `Wider post spacing (120–240m) was associated with higher median reach (${bestBucket.median_reach}) in the observed sample (N=${bestBucket.sample_size}). Correlation observed, not causal evidence.`;
        } else {
          chosenMin = 120;
          chosenMax = 180;
          strategy = 'OFF_PEAK_SPACING';
          strategyReason = `Wide post spacing (240m+) was associated with higher median reach in the observed sample (N=${bestBucket.sample_size}). Correlation observed, not causal evidence.`;
        }
      }
    }

    // 5. Preferred Time Windows Analysis
    const timeSlots = await growthMetricsService.getTimeSlotAnalysis();
    const preferredWindows: PreferredPostingWindow[] = [];

    if (timeSlots.length > 0) {
      // Find hours with above-median reach
      const validSlots = timeSlots.filter((s) => s.sample_size > 0);
      if (validSlots.length > 0) {
        const sortedSlots = [...validSlots].sort((a, b) => b.median_reach - a.median_reach);
        const topSlots = sortedSlots.slice(0, 3);

        for (const slot of topSlots) {
          const startH = String(slot.hour_of_day).padStart(2, '0');
          const endH = String((slot.hour_of_day + 2) % 24).padStart(2, '0');
          preferredWindows.push({
            start: `${startH}:00`,
            end: `${endH}:00`,
            dayOfWeek: slot.day_of_week,
            medianReach: slot.median_reach,
            label: `Observed Peak (${slot.median_reach} median reach, N=${slot.sample_size})`,
          });
        }
      }
    }

    if (preferredWindows.length === 0) {
      preferredWindows.push({
        start: '18:00',
        end: '21:30',
        label: 'Evening Campus Activity Window (Observational Default)',
      });
      preferredWindows.push({
        start: '12:00',
        end: '14:30',
        label: 'Afternoon Campus Lunch Window',
      });
    } else {
      strategy = 'PEAK_WINDOW_PACING';
    }

    // 6. Format-Specific Cadence
    const formats = await growthMetricsService.getFormatComparison();
    const reelStat = formats.find((f) => f.format_type === 'REEL');
    const imageStat = formats.find((f) => f.format_type === 'IMAGE');

    const formatCadenceMap: Record<string, { minGap: number; maxGap: number; reason: string }> = {
      IMAGE: {
        minGap: chosenMin,
        maxGap: chosenMax,
        reason: `Standard baseline pacing for static image cards (${imageStat?.median_reach ?? 0} median reach, N=${imageStat?.sample_size ?? 0}).`,
      },
      CAROUSEL: {
        minGap: Math.max(45, chosenMin),
        maxGap: Math.max(chosenMax, 90),
        reason: 'Multi-slide carousels retain audience engagement over extended browse sessions.',
      },
    };

    if (reelStat && reelStat.sample_size >= 3) {
      formatCadenceMap['REEL'] = {
        minGap: Math.max(30, chosenMin - 15),
        maxGap: Math.max(45, chosenMax - 10),
        reason: `Reels showed faster initial velocity in observed sample (N=${reelStat.sample_size}). Moderately tighter cadence is supported.`,
      };
    } else {
      formatCadenceMap['REEL'] = {
        minGap: chosenMin,
        maxGap: chosenMax,
        reason: 'Insufficient Reel samples (N<3). Using balanced image cadence.',
      };
    }

    // 7. Category-Specific Cadence
    const categoryStats = await growthMetricsService.getCategoryGrowthStats();
    const categoryCadenceMap: Record<string, { minGap: number; maxGap: number; reason: string }> = {};

    for (const cat of categoryStats) {
      if (cat.post_count >= 2) {
        if (cat.share_rate > 8.0) {
          categoryCadenceMap[cat.category] = {
            minGap: Math.max(35, chosenMin - 10),
            maxGap: chosenMax,
            reason: `Category "${cat.category}" had high observed viral share rate (${cat.share_rate}%). Tighter clustering observed during peaks.`,
          };
        } else {
          categoryCadenceMap[cat.category] = {
            minGap: chosenMin,
            maxGap: chosenMax,
            reason: `Category "${cat.category}" performance aligns with balanced cadence (${cat.median_reach} median reach).`,
          };
        }
      }
    }

    // 8. Viral Cooldown Policy
    const viralCooldownPolicy = {
      triggerReachMultiplier: 1.8,
      cooldownMinutes: Math.min(180, Math.round(chosenMax * 1.4)),
      reason: 'If a post achieves >1.8x median reach, a longer cooldown prevents cannibalizing engagement of the trending post.',
    };

    // 9. Peak & Off-Peak Hours and Weekdays Analysis
    const sortedHours = [...timeSlots].filter((s) => s.sample_size > 0).sort((a, b) => b.median_reach - a.median_reach);
    const bestHour = sortedHours.length > 0 ? sortedHours[0].hour_of_day : 19;
    const secondBestHour = sortedHours.length > 1 ? sortedHours[1].hour_of_day : 20;
    const worstHour = sortedHours.length > 0 ? sortedHours[sortedHours.length - 1].hour_of_day : 14;

    const weekdayMap = new Map<number, number[]>();
    for (const slot of timeSlots) {
      if (!weekdayMap.has(slot.day_of_week)) weekdayMap.set(slot.day_of_week, []);
      if (slot.median_reach > 0) weekdayMap.get(slot.day_of_week)!.push(slot.median_reach);
    }
    const weekdayAverages = Array.from(weekdayMap.entries()).map(([day, reaches]) => ({
      day,
      avg: reaches.length > 0 ? reaches.reduce((a, b) => a + b, 0) / reaches.length : 0,
    })).sort((a, b) => b.avg - a.avg);

    const bestWeekday = weekdayAverages.length > 0 ? weekdayAverages[0].day : 4; // Thursday
    const worstWeekday = weekdayAverages.length > 0 ? weekdayAverages[weekdayAverages.length - 1].day : 2; // Tuesday

    const peakHoursSummary = {
      bestHour,
      secondBestHour,
      worstHour,
      bestWeekday,
      worstWeekday,
    };

    const avgGap = (chosenMin + chosenMax) / 2;
    const targetDailyPosts = settings.target_daily_posts || 4;
    const recommendedPostsPerHour = Math.round((60 / avgGap) * 10) / 10;
    const recommendedPostsPerThreeHours = Math.min(4, Math.max(1, Math.round(180 / avgGap)));
    const cooldownMinutes = Math.max(30, Math.round(chosenMin * 0.7));

    const topCategory = categoryStats.length > 0 ? categoryStats[0].category : 'CRUSH';
    const topFormat = formats.length > 0 ? formats.sort((a, b) => b.median_reach - a.median_reach)[0].format_type : 'CAROUSEL';

    const postingStrategySummary = {
      recommendedPostsPerDay: targetDailyPosts,
      averageGapMinutes: Math.round(avgGap),
      bestWindow: preferredWindows[0]?.label || '18:00 - 21:30',
      bestCategory: topCategory,
      bestFormat: topFormat,
      reason: strategyReason,
    };

    return {
      id: `rec-growth-${Date.now()}`,
      strategy,
      mode: 'growth_optimized',
      recommendedGapRangeMinutes: { min: chosenMin, max: chosenMax },
      recommendedPostsPerHour,
      recommendedPostsPerThreeHours,
      recommendedDailyPosts: targetDailyPosts,
      cooldownMinutes,
      preferredWindows,
      confidence,
      supportState,
      evidenceCount,
      reason: strategyReason,
      explorationAllowed: confidence !== 'HIGH',
      formatCadenceMap,
      categoryCadenceMap,
      viralCooldownPolicy,
      peakHoursSummary,
      postingStrategySummary,
      generated_at: new Date().toISOString(),
      version: '1.0.0-growth-adaptive',
    };
  }

  /**
   * Calculate effective gap for a specific post taking format and category into account
   */
  public calculateEffectiveGap(
    recommendation: SchedulerRecommendation,
    formatType?: MediaFormatType,
    category?: string
  ): { min: number; max: number; rolledGap: number; reason: string } {
    const isManual = recommendation.mode === 'manual' || recommendation.strategy === 'ADMIN_OVERRIDE';
    let min = recommendation.recommendedGapRangeMinutes.min;
    let max = recommendation.recommendedGapRangeMinutes.max;
    let reason = recommendation.reason;

    // Only apply format / category overrides if NOT in manual / fixed cooldown mode
    if (!isManual) {
      // Format override if present
      if (formatType && recommendation.formatCadenceMap?.[formatType]) {
        const fmt = recommendation.formatCadenceMap[formatType];
        min = fmt.minGap;
        max = fmt.maxGap;
        reason = `${fmt.reason} (${reason})`;
      }

      // Category override if present
      if (category && recommendation.categoryCadenceMap?.[category]) {
        const cat = recommendation.categoryCadenceMap[category];
        min = Math.min(min, cat.minGap);
        reason = `${cat.reason} · ${reason}`;
      }
    }

    // Apply controlled random jitter strictly INSIDE the evidence-backed interval
    const rolledGap = Math.floor(Math.random() * (max - min + 1)) + min;

    return { min, max, rolledGap, reason };
  }

  /**
   * Authority-Driven Daily Growth Plan:
   * Reconciles Settings (Hard Limits) vs Growth Intelligence (Performance Strategy).
   * - Target daily posts is strictly a fallback when data or confidence is insufficient.
   * - Growth Intelligence is authoritative when sample size >= min_posts_for_cadence_learning,
   *   days >= min_days_for_cadence_learning, and confidence >= min_growth_confidence.
   * - Hard limits (min_daily_posts, max_daily_posts) are strictly enforced and can NEVER be exceeded.
   */
  public async generateDailyGrowthPlan(date?: Date, forceFresh: boolean = false): Promise<DailyGrowthPlan> {
    const nowMs = Date.now();
    if (!forceFresh && this.cachedDailyPlan && nowMs < this.dailyPlanCacheExpiresAtMs) {
      return this.cachedDailyPlan;
    }

    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const targetDate = date || new Date();
    const dateKey = growthMetricsService.getDateKeyInAccountTz(targetDate, tz);

    const minAllowed = Math.max(1, settings.min_daily_posts ?? 2);
    const maxAllowed = Math.max(minAllowed, settings.max_daily_posts ?? 12);
    const targetFallback = Math.min(Math.max(settings.target_daily_posts ?? 4, minAllowed), maxAllowed);

    const minPostsThreshold = settings.min_posts_for_cadence_learning ?? 20;
    const minDaysThreshold = settings.min_days_for_cadence_learning ?? 7;
    const minConfidenceThreshold = settings.min_growth_confidence ?? 0.70;
    const rollingHorizonHours = settings.rolling_horizon_hours ?? 24;

    const saturation = await growthMetricsService.getPostingFrequencySaturationAnalysis();
    const strategyMode = settings.scheduling_strategy_mode || 'AUTO';

    const hasSufficientEvidence =
      saturation.sample_size >= minPostsThreshold &&
      saturation.days_of_data >= minDaysThreshold &&
      saturation.confidence >= minConfidenceThreshold;

    let isFallback = false;
    let authoritySource: AuthoritySource;
    let recommendedPosts: number;
    let effectiveDailyPosts: number;
    let reason: string;

    if (strategyMode === 'MANUAL') {
      isFallback = true;
      authoritySource = 'ADMIN_OVERRIDE';
      recommendedPosts = targetFallback;
      effectiveDailyPosts = targetFallback;
      reason = `Admin override mode active. Using manual operational quota (${effectiveDailyPosts} posts/day).`;
    } else if (strategyMode === 'BASELINE') {
      isFallback = true;
      authoritySource = 'SETTINGS_FALLBACK';
      recommendedPosts = targetFallback;
      effectiveDailyPosts = targetFallback;
      reason = `Baseline Exploration mode active. Using operational target fallback of ${effectiveDailyPosts} posts/day bounded by settings [${minAllowed}-${maxAllowed}].`;
    } else if (!hasSufficientEvidence) {
      isFallback = true;
      authoritySource = 'SETTINGS_FALLBACK';
      recommendedPosts = targetFallback;
      effectiveDailyPosts = targetFallback;
      reason = `Insufficient historical evidence (posts: ${saturation.sample_size}/${minPostsThreshold}, days: ${saturation.days_of_data}/${minDaysThreshold}, confidence: ${(saturation.confidence * 100).toFixed(0)}%/${(minConfidenceThreshold * 100).toFixed(0)}%). Using operational target fallback of ${effectiveDailyPosts} posts/day bounded by settings guardrails [${minAllowed}-${maxAllowed}].`;
    } else {
      // Growth Intelligence is authoritative!
      isFallback = false;
      recommendedPosts = saturation.optimal_posts_per_day;
      // Clamping strictly inside hard limits
      effectiveDailyPosts = Math.min(Math.max(recommendedPosts, minAllowed), maxAllowed);

      if (effectiveDailyPosts !== recommendedPosts) {
        authoritySource = 'SETTINGS_HARD_LIMIT';
        reason = `Growth Intelligence recommended ${recommendedPosts} posts/day based on empirical reach saturation across N=${saturation.sample_size} posts, clamped to ${effectiveDailyPosts} by hard settings limits [${minAllowed}-${maxAllowed}].`;
      } else {
        authoritySource = 'GROWTH_INTELLIGENCE';
        const degradationText = saturation.degradation_detected
          ? ` with degradation observed beyond ${saturation.saturation_knee_point || recommendedPosts} posts/day`
          : '';
        reason = `Growth Intelligence authoritative: In observed sample (N=${saturation.sample_size} posts across ${saturation.days_of_data} days, confidence ${(saturation.confidence * 100).toFixed(0)}%), ${recommendedPosts} posts/day demonstrated optimal reach-per-post balance${degradationText}. Overriding target (${targetFallback}/day).`;
      }
    }

    // Preferred windows & format/category preferences
    const baseRec = await this.getCadenceRecommendation();
    const formats = await growthMetricsService.getFormatComparison();
    const categories = await growthMetricsService.getCategoryGrowthStats();

    const preferredFormats = formats
      .sort((a, b) => b.median_reach - a.median_reach)
      .map((f) => f.format_type);

    const preferredCategories = categories
      .filter((c) => c.post_count > 0)
      .sort((a, b) => b.median_reach - a.median_reach)
      .slice(0, 5)
      .map((c) => c.category);

    const minGap = Math.max(settings.min_gap_minutes ?? 30, baseRec.recommendedGapRangeMinutes.min);
    const maxGap = Math.max(minGap + 10, settings.max_gap_minutes ?? 75, baseRec.recommendedGapRangeMinutes.max);

    const plan: DailyGrowthPlan = {
      date: dateKey,
      recommended_posts: recommendedPosts,
      effective_daily_posts: effectiveDailyPosts,
      min_allowed_posts: minAllowed,
      max_allowed_posts: maxAllowed,
      target_fallback_posts: targetFallback,
      confidence: Math.round(saturation.confidence * 100) / 100,
      sample_size: saturation.sample_size,
      days_of_data: saturation.days_of_data,
      is_fallback: isFallback,
      authority_source: authoritySource,
      preferred_windows: baseRec.preferredWindows.map((w) => ({
        start: w.start,
        end: w.end,
        label: w.label,
      })),
      recommended_spacing: {
        min_minutes: minGap,
        max_minutes: maxGap,
      },
      preferred_categories: preferredCategories,
      preferred_formats: preferredFormats.length > 0 ? preferredFormats : ['IMAGE', 'CAROUSEL'],
      reason,
      saturation_detected: saturation.degradation_detected,
      saturation_knee_posts_per_day: saturation.saturation_knee_point ?? undefined,
      degradation_observed: saturation.degradation_detected,
      rolling_horizon_hours: rollingHorizonHours,
      generated_at: new Date().toISOString(),
    };

    this.cachedDailyPlan = plan;
    this.dailyPlanCacheExpiresAtMs = nowMs + 15 * 60 * 1000;
    return plan;
  }
}

export const cadenceAnalyzer = new CadenceAnalyzer();
