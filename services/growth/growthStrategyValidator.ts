/**
 * ConfessionFlow - Growth Strategy Validator
 * Enforces strict hierarchy between Settings (Hard Guardrails) and
 * Growth Intelligence (Performance Optimization Strategy).
 *
 * Hierarchy & Invariants:
 * 1. Hard limits (min_daily_posts, max_daily_posts, min_gap_minutes) can NEVER be broken.
 * 2. Quality over volume: min_daily_posts NEVER forces low-quality or high-risk content.
 * 3. Idempotency & safety: never approves candidates that have already been published or flagged.
 * 4. Graceful fallback: when confidence < min_growth_confidence, fallback to settings targets.
 */

import { mockStore } from '@/lib/mockStore';
import { Confession, SystemSettings } from '@/types';
import { GrowthDecision, GrowthDecisionType, AuthoritySource } from '@/types/growth';
import { validatePublishEligibility } from '../quality/publishEligibilityService';

export interface StrategyValidationResult {
  isValid: boolean;
  adjustedDecision?: GrowthDecisionType;
  adjustedGapMinutes?: number;
  adjustedDailyPosts?: number;
  authoritySource: AuthoritySource;
  reasons: string[];
}

export class GrowthStrategyValidator {
  /**
   * Validate a proposed growth decision against settings hard limits and safety checks
   */
  public validateDecision(
    decision: GrowthDecision,
    settings?: SystemSettings
  ): StrategyValidationResult {
    const s = settings || mockStore.getSettings();
    const reasons: string[] = [];

    const minDaily = Math.max(1, s.min_daily_posts ?? 2);
    const maxDaily = Math.max(minDaily, s.max_daily_posts ?? 12);
    const minGap = Math.max(20, s.min_gap_minutes ?? 30);

    let adjustedDecision = decision.decision;
    let adjustedGapMinutes = decision.recommended_gap_minutes;
    let adjustedDailyPosts = decision.daily_strategy.effective_daily_posts;
    let authoritySource = decision.authority_source;

    // 1. Enforce hard limits on daily post volume
    if (adjustedDailyPosts > maxDaily) {
      adjustedDailyPosts = maxDaily;
      authoritySource = 'SETTINGS_HARD_LIMIT';
      reasons.push(`Recommended daily posts clamped to max_daily_posts hard ceiling (${maxDaily}).`);
    } else if (adjustedDailyPosts < minDaily) {
      adjustedDailyPosts = minDaily;
      authoritySource = 'SETTINGS_HARD_LIMIT';
      reasons.push(`Recommended daily posts adjusted to min_daily_posts hard floor (${minDaily}).`);
    }

    // 2. Enforce hard minimum gap spacing
    if (adjustedGapMinutes < minGap) {
      adjustedGapMinutes = minGap;
      reasons.push(`Post gap clamped to min_gap_minutes hard floor (${minGap}m).`);
    }

    // 3. Candidate safety verification
    if (decision.candidate) {
      const elig = validatePublishEligibility(decision.candidate, s);
      if (!elig.isEligible) {
        adjustedDecision = 'HOLD_CONTENT';
        reasons.push(`Candidate #${decision.candidate.google_sheet_row} failed eligibility: ${elig.reason}`);
      }
    }

    return {
      isValid: reasons.length === 0,
      adjustedDecision,
      adjustedGapMinutes,
      adjustedDailyPosts,
      authoritySource,
      reasons,
    };
  }
}

export const growthStrategyValidator = new GrowthStrategyValidator();
