/**
 * ConfessionFlow - Growth Recommendation Service & Content Planner
 * Provides evidence-based recommendations for format, timing, and hook styling.
 * Strictly adheres to non-causal observational reporting and never auto-schedules without admin approval.
 */

import { GrowthRecommendation, MediaFormatType, ConfidenceLevel } from '@/types/growth';
import { growthMetricsService } from './growthMetricsService';
import { contentFeatureExtractor } from './contentFeatureExtractor';
import { growthStore } from '@/lib/growthStore';
import { Confession } from '@/types';

export class GrowthRecommendationService {
  /**
   * Generates a smart publishing recommendation for a specific confession.
   */
  public async generateRecommendation(confession: Confession): Promise<GrowthRecommendation> {
    const text = confession.cleaned_text || confession.original_text;
    const features = await contentFeatureExtractor.extractFeatures(confession.id, text);

    const formats = await growthMetricsService.getFormatComparison();
    const timeSlots = await growthMetricsService.getTimeSlotAnalysis();
    const categories = await growthMetricsService.getCategoryGrowthStats();
    const hooks = await growthMetricsService.getHookPerformanceStats();

    // 1. Format Selection
    const reelStat = formats.find((f) => f.format_type === 'REEL');
    const imageStat = formats.find((f) => f.format_type === 'IMAGE');

    let recommendedFormat: MediaFormatType = 'IMAGE';
    let formatEvidence = 0;
    let formatRationale = '';

    if (reelStat && imageStat && reelStat.sample_size >= 5 && reelStat.median_reach > imageStat.median_reach) {
      recommendedFormat = 'REEL';
      formatEvidence = reelStat.sample_size;
      formatRationale = `Reels showed a higher median reach (${reelStat.median_reach}) compared to static images (${imageStat.median_reach}) across N=${reelStat.sample_size} published Reels in your account history. This is an observed correlation, not proof of causation.`;
    } else {
      recommendedFormat = 'IMAGE';
      formatEvidence = imageStat ? imageStat.sample_size : 0;
      formatRationale = `Static images have reliable performance baseline (${imageStat?.median_reach ?? 0} median reach) with consistent engagement.`;
    }

    // 2. Best Performing Time Window
    // Sort time slots by median reach
    const sortedSlots = [...timeSlots].sort((a, b) => b.median_reach - a.median_reach);
    const topSlot = sortedSlots[0] || { hour_of_day: 19, median_reach: 0 };
    const formattedHour = topSlot.hour_of_day % 12 || 12;
    const ampm = topSlot.hour_of_day >= 12 ? 'PM' : 'AM';
    const recommendedTime = `${formattedHour}:30 ${ampm}`;

    // 3. Hook Style
    const sortedHooks = [...hooks].sort((a, b) => b.median_reach - a.median_reach);
    const topHook = sortedHooks[0]?.hook_type || features.hook_type;

    // 4. Confidence evaluation
    let confidence: ConfidenceLevel = 'LOW';
    if (formatEvidence >= 20) confidence = 'HIGH';
    else if (formatEvidence >= 8) confidence = 'MEDIUM';

    const recommendationId = `rec-${confession.id}-${Date.now()}`;
    const recommendation: GrowthRecommendation = {
      id: recommendationId,
      content_id: confession.id,
      recommended_time: recommendedTime,
      recommended_format: recommendedFormat,
      recommended_category: features.category,
      recommended_hook_style: topHook,
      recommended_content_length: features.word_count < 30 ? 'Short' : features.word_count < 80 ? 'Medium' : 'Long',
      recommended_gap_range: '45–95 minutes',
      recommendation_confidence: confidence,
      evidence_count: formatEvidence,
      rationale: formatRationale,
      confounders_noted: [
        'Time-of-day viewer traffic variations',
        'Category interest seasonality',
        'Academic calendar cycles (exam vs holiday periods)',
      ],
      status: 'PENDING',
      generated_at: new Date().toISOString(),
    };

    await growthStore.saveRecommendation(recommendation);
    return recommendation;
  }

  /**
   * Record admin action on recommendation (Accepted, Rejected, Overridden)
   */
  public async recordFeedback(
    recommendationId: string,
    action: 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'OVERRIDDEN',
    feedbackNotes?: string
  ) {
    return await growthStore.recordFeedback({
      id: `fb-${Date.now()}`,
      recommendation_id: recommendationId,
      action,
      feedback_notes: feedbackNotes,
      created_at: new Date().toISOString(),
    });
  }
}

export const growthRecommendationService = new GrowthRecommendationService();
