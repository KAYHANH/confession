/**
 * ConfessionFlow - Growth Scheduling Intelligence Agent
 * Groq AI recommendation layer for adaptive scheduling.
 * Formulates next post format, publish window, and cadence recommendations
 * based on statistical account metrics and Zod schema validation.
 *
 * NOTE: Groq is the intelligence/recommendation layer ONLY.
 * The actual schedule execution is strictly validated and guarded by ScheduleValidationService.
 */

import Groq from 'groq-sdk';
import { z } from 'zod';
import {
  GroqSchedulingRecommendation,
  MediaFormatType,
  ConfidenceLevel,
} from '@/types/growth';
import { growthMetricsService } from './growthMetricsService';
import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';

// Zod Schema to strictly validate Groq output
export const GroqSchedulingRecommendationSchema = z.object({
  strategy: z.string(),
  recommended_format: z.enum(['IMAGE', 'CAROUSEL', 'REEL', 'VIDEO']),
  recommended_category_preference: z.string().optional(),
  recommended_publish_window: z.object({
    start: z.string(),
    end: z.string(),
  }),
  recommended_gap_minutes: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  }),
  recommended_posts_per_3h: z.number().positive(),
  recommended_daily_posts: z.number().min(1).max(24).optional(),
  recommended_next_publish_at: z.string(),
  wait_before_publishing_minutes: z.number().nonnegative(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidence_count: z.number().nonnegative(),
  reason: z.string(),
  alternative: z.object({
    format: z.enum(['IMAGE', 'CAROUSEL', 'REEL', 'VIDEO']),
    window: z.string(),
  }),
  exploration: z.object({
    enabled: z.boolean(),
    percentage: z.number().min(0).max(100),
  }),
});

export class GrowthSchedulingAgent {
  private groqClient: Groq | null = null;
  private readonly MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey && apiKey.trim().length > 0) {
      this.groqClient = new Groq({ apiKey });
    }
  }

  /**
   * Produce a safe deterministic baseline recommendation when data is insufficient or Groq fails
   */
  public generateFallbackRecommendation(
    evidenceCount: number,
    reason: string = 'Fallback baseline scheduling applied.'
  ): GroqSchedulingRecommendation {
    const now = new Date();
    // Default safe next publish in 60 minutes
    const nextPublish = new Date(now.getTime() + 60 * 60000).toISOString();

    return {
      strategy: 'BASELINE_EXPLORATION',
      recommended_format: 'IMAGE',
      recommended_category_preference: undefined,
      recommended_publish_window: {
        start: '19:00',
        end: '21:00',
      },
      recommended_gap_minutes: {
        min: 60,
        max: 90,
      },
      recommended_posts_per_3h: 1,
      recommended_daily_posts: 4,
      recommended_next_publish_at: nextPublish,
      wait_before_publishing_minutes: 60,
      confidence: 'LOW',
      evidence_count: evidenceCount,
      reason,
      alternative: {
        format: 'CAROUSEL',
        window: '21:00 - 22:00',
      },
      exploration: {
        enabled: true,
        percentage: 30,
      },
    };
  }

  /**
   * Main entry point: Formulate next scheduling recommendation
   */
  public async getNextSchedulingRecommendation(options?: {
    forceBaseline?: boolean;
  }): Promise<GroqSchedulingRecommendation> {
    const summary = await growthMetricsService.getAccountLearningSummary();
    const evidenceCount = summary.total_posts_analyzed;

    // Rule: When sample size < 5, fall back safely to BASELINE + EXPLORATION with confidence LOW
    if (evidenceCount < 5 || options?.forceBaseline) {
      return this.generateFallbackRecommendation(
        evidenceCount,
        evidenceCount < 5
          ? `Sample size is insufficient (N=${evidenceCount} < 5). Using safe baseline schedule with format exploration.`
          : 'Deterministic baseline forced by system parameters.'
      );
    }

    // Gather pre-aggregated data
    const formatStats = await growthMetricsService.getFormatDetailedAnalysis();
    const categoryStats = await growthMetricsService.getCategoryGrowthAnalysis();
    const timeStats = await growthMetricsService.getDetailedTimeSlotAnalysis();
    const gapStats = await growthMetricsService.getDetailedPostGapAnalysis();
    const densityStats = await growthMetricsService.getPostDensityAnalysis();
    const recencyTrends = await growthMetricsService.getRecencyTrends();
    const saturationStats = await growthMetricsService.getPostingFrequencySaturationAnalysis();

    // If Groq client is unavailable, synthesize deterministic data-driven recommendation
    if (!this.groqClient) {
      return this.generateDataDrivenRecommendation(
        summary,
        formatStats,
        categoryStats,
        timeStats,
        gapStats,
        saturationStats
      );
    }

    try {
      // Assemble structured prompt with strict pre-aggregated figures
      const systemPrompt = `You are ConfessionFlow's Primary Scheduling Brain for Instagram confessions.
Your role: Analyze account historical performance data and recommend the optimal format, publish window, spacing, and exploration rate for the NEXT post.

STRATEGIC OBJECTIVE:
FEWER POSTS + HIGHER AVERAGE REACH + BETTER MEASUREMENT + DATA-DRIVEN SCHEDULING.
- Do NOT optimize for maximum publishing throughput.
- Target daily volume: recommend optimal daily frequency based on empirical frequency saturation data.
- Spacing: Protect observation windows (15m, 30m, 60m, 3h, 6h, 24h) and allow each post to accumulate reach before the next post.

OUTPUT RULES:
- Output MUST be valid JSON only. No prose, markdown or code blocks.
- Adhere strictly to the requested schema.
- Epistemological constraint: Do NOT make causal claims (e.g. "60m spacing causes higher reach"). Express observations as patterns observed in sample.
- Consider format performance, peak growth times, post gaps, density, and frequency saturation.`;

      const userPayload = {
        account_summary: {
          total_posts: summary.total_posts_analyzed,
          median_views: summary.median_views,
          median_reach: summary.median_reach,
          views_p25_p50_p75_p90: summary.views_distribution,
          best_format: summary.best_performing_format,
          best_category: summary.best_performing_category,
          best_window: summary.best_observed_window,
          best_post_growth_window: summary.best_observed_post_growth_window,
          best_cadence: summary.best_observed_cadence,
        },
        frequency_saturation: {
          sample_posts: saturationStats.sample_size,
          sample_days: saturationStats.days_of_data,
          optimal_posts_per_day: saturationStats.optimal_posts_per_day,
          degradation_detected: saturationStats.degradation_detected,
          knee_point: saturationStats.saturation_knee_point,
          confidence: saturationStats.confidence,
          summary: saturationStats.summary,
          buckets: saturationStats.buckets.map((b) => ({
            posts_per_day: b.posts_per_day,
            sample_days: b.sample_days,
            median_reach_per_post: b.median_reach_per_post,
            median_total_daily_reach: b.median_total_daily_reach,
            degradation_percent: b.degradation_percent_vs_peak,
          })),
        },
        formats: formatStats.map((f) => ({
          format: f.format_type,
          sample_size: f.sample_size,
          median_views: f.median_views,
          median_reach: f.median_reach,
          share_rate: f.share_rate,
          save_rate: f.save_rate,
        })),
        top_categories: categoryStats
          .filter((c) => c.post_count > 0)
          .sort((a, b) => b.median_reach - a.median_reach)
          .slice(0, 5)
          .map((c) => ({
            category: c.category,
            count: c.post_count,
            median_reach: c.median_reach,
            median_24h_views: c.median_24h_views,
          })),
        gap_buckets: gapStats.map((g) => ({
          bucket: g.gap_bucket,
          sample: g.sample_size,
          median_reach: g.median_reach,
          finding: g.observational_finding,
        })),
        recency: {
          rising_categories: recencyTrends.rising_categories.map((r) => r.name),
          declining_categories: recencyTrends.declining_categories.map((r) => r.name),
          rising_formats: recencyTrends.rising_formats.map((r) => r.name),
        },
        current_time_utc: new Date().toISOString(),
      };

      const completion = await this.groqClient.chat.completions.create({
        model: this.MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Analyze this account data and recommend the next schedule:\n${JSON.stringify(userPayload, null, 2)}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const rawContent = completion.choices[0]?.message?.content || '{}';
      const parsedJson = JSON.parse(rawContent);

      // Validate with Zod
      const validated = GroqSchedulingRecommendationSchema.parse(parsedJson);
      return validated;
    } catch (err: any) {
      console.warn('[GrowthSchedulingAgent] Groq recommendation failed or failed Zod validation, falling back safely:', err?.message || err);
      return this.generateDataDrivenRecommendation(
        summary,
        formatStats,
        categoryStats,
        timeStats,
        gapStats,
        saturationStats
      );
    }
  }

  /**
   * Deterministic data-driven recommendation based on account aggregated metrics
   */
  private generateDataDrivenRecommendation(
    summary: any,
    formats: any[],
    categories: any[],
    timeWindows: any[],
    gaps: any[],
    saturationStats?: any
  ): GroqSchedulingRecommendation {
    const evidenceCount = summary.total_posts_analyzed || 0;
    const bestFormat = summary.best_performing_format || 'IMAGE';
    const bestCategory = summary.best_performing_category || 'relationship';

    // Best window
    const sortedWindows = [...timeWindows]
      .filter((w) => w.sample_size > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const topWindow = sortedWindows[0];
    const windowStart = topWindow ? `${topWindow.hour_of_day.toString().padStart(2, '0')}:00` : '19:00';
    const windowEnd = topWindow ? `${((topWindow.hour_of_day + 1) % 24).toString().padStart(2, '0')}:00` : '21:00';

    // Best gap
    const sortedGaps = [...gaps]
      .filter((g) => g.sample_size > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const topGap = sortedGaps[0]?.gap_bucket || '60–90m';
    let minGap = 60;
    let maxGap = 90;
    if (topGap === '30–60m') {
      minGap = 30;
      maxGap = 60;
    } else if (topGap === '90–120m') {
      minGap = 90;
      maxGap = 120;
    } else if (topGap === '120–180m') {
      minGap = 120;
      maxGap = 180;
    }

    const now = new Date();
    const waitMins = Math.round((minGap + maxGap) / 2);
    const nextPublish = new Date(now.getTime() + waitMins * 60000).toISOString();

    let confidence: ConfidenceLevel = 'LOW';
    if (evidenceCount >= 20) confidence = 'HIGH';
    else if (evidenceCount >= 10) confidence = 'MEDIUM';

    // Alternative format
    const altFormat: MediaFormatType =
      bestFormat === 'REEL' ? 'CAROUSEL' : bestFormat === 'CAROUSEL' ? 'IMAGE' : 'REEL';

    const optimalDaily = saturationStats?.optimal_posts_per_day || 4;
    const saturationNote = saturationStats?.degradation_detected
      ? ` Saturation analysis indicates knee at ${saturationStats.saturation_knee_point || optimalDaily} posts/day.`
      : '';

    return {
      strategy: 'DATA_DRIVEN_PEAK_VELOCITY',
      recommended_format: bestFormat,
      recommended_category_preference: bestCategory,
      recommended_publish_window: {
        start: windowStart,
        end: windowEnd,
      },
      recommended_gap_minutes: {
        min: minGap,
        max: maxGap,
      },
      recommended_posts_per_3h: 1,
      recommended_daily_posts: optimalDaily,
      recommended_next_publish_at: nextPublish,
      wait_before_publishing_minutes: waitMins,
      confidence,
      evidence_count: evidenceCount,
      reason: `Historical sample (N=${evidenceCount}) shows ${bestFormat} format had highest median reach (${summary.median_reach}). Best observed window is ${windowStart}-${windowEnd} with ${topGap} gap.${saturationNote}`,
      alternative: {
        format: altFormat,
        window: '21:00 - 22:00',
      },
      exploration: {
        enabled: true,
        percentage: 20,
      },
    };
  }
}

export const growthSchedulingAgent = new GrowthSchedulingAgent();
