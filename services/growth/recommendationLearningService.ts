/**
 * ConfessionFlow - Recommendation Learning & Accountability Service
 * Tracks recommendations against actual real-world publishing outcomes.
 * Enables the closed learning loop:
 * RECOMMEND → VALIDATE → PUBLISH → MEASURE → EVALUATE ACCURACY → MODEL LEARNS
 */

import {
  RecommendationRecord,
  GroqSchedulingRecommendation,
  MediaFormatType,
  RecommendationOutcomeType,
} from '@/types/growth';
import { Confession } from '@/types';
import { growthStore } from '@/lib/growthStore';
import { ValidatedScheduleResult } from './scheduleValidationService';

export class RecommendationLearningService {
  /**
   * Log an issued recommendation and its validation status
   */
  public async logRecommendation(
    recommendation: GroqSchedulingRecommendation,
    validationResult: ValidatedScheduleResult,
    confession?: Confession
  ): Promise<RecommendationRecord> {
    const id = `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date().toISOString();

    const record: RecommendationRecord = {
      id,
      content_id: confession?.id,
      confession_row: confession?.google_sheet_row,
      recommended_at: now,
      recommended_time: recommendation.recommended_next_publish_at,
      actual_publish_time: null,
      recommended_gap: Math.round(
        (recommendation.recommended_gap_minutes.min +
          recommendation.recommended_gap_minutes.max) /
          2
      ),
      actual_gap: null,
      recommended_format: recommendation.recommended_format,
      actual_format: null,
      expected_performance_percentile:
        recommendation.confidence === 'HIGH' ? 75 : recommendation.confidence === 'MEDIUM' ? 60 : 50,
      actual_performance_percentile: null,
      recommendation_accuracy: null,
      recommendation_outcome: 'PENDING',
      groq_recommendation: recommendation,
      validation_status: validationResult.status,
      applied_schedule_timestamp: validationResult.targetTimestamp,
      status: 'PENDING',
      notes: validationResult.adjustments.join('; ') || undefined,
    };

    return await growthStore.saveRecommendationRecord(record);
  }

  /**
   * Record when user accepts a recommendation
   */
  public async acceptRecommendation(id: string): Promise<RecommendationRecord | null> {
    return await growthStore.updateRecommendationRecord(id, {
      status: 'ACCEPTED',
    });
  }

  /**
   * Record when user manually overrides a recommendation
   */
  public async overrideRecommendation(
    id: string,
    override: {
      format?: MediaFormatType;
      scheduleTime?: string;
      reason?: string;
    }
  ): Promise<RecommendationRecord | null> {
    return await growthStore.updateRecommendationRecord(id, {
      status: 'OVERRIDDEN',
      notes: override.reason ? `Overridden: ${override.reason}` : 'Manually overridden by user.',
    });
  }

  /**
   * Evaluate pending recommendation records against observed performance data
   */
  public async evaluatePendingRecommendations(): Promise<number> {
    const recs = await growthStore.getRecommendationRecords();
    const pendingRecs = recs.filter((r) => r.recommendation_outcome === 'PENDING' && r.content_id);
    if (pendingRecs.length === 0) return 0;

    const postRecords = await growthStore.getPostPerformanceRecords();
    let evaluatedCount = 0;

    for (const rec of pendingRecs) {
      const matchedPost = postRecords.find((p) => p.post_id === rec.content_id);
      if (matchedPost && typeof matchedPost.percentile === 'number') {
        const actualPercentile = matchedPost.percentile;
        const expectedPercentile = rec.expected_performance_percentile ?? 50;

        let outcome: RecommendationOutcomeType = 'MET_EXPECTATION';
        if (actualPercentile > expectedPercentile + 15) {
          outcome = 'OUTPERFORMED_EXPECTATION';
        } else if (actualPercentile < expectedPercentile - 15) {
          outcome = 'UNDERPERFORMED_EXPECTATION';
        }

        const accuracy = Math.max(0, 100 - Math.abs(expectedPercentile - actualPercentile));

        await growthStore.updateRecommendationRecord(rec.id, {
          actual_publish_time: matchedPost.published_at,
          actual_gap: matchedPost.previous_post_gap_minutes,
          actual_format: matchedPost.format,
          actual_performance_percentile: actualPercentile,
          recommendation_accuracy: accuracy,
          recommendation_outcome: outcome,
        });

        evaluatedCount++;
      }
    }

    return evaluatedCount;
  }

  /**
   * Get all recommendation records
   */
  public async getRecommendationHistory(): Promise<RecommendationRecord[]> {
    return await growthStore.getRecommendationRecords();
  }
}

export const recommendationLearningService = new RecommendationLearningService();
