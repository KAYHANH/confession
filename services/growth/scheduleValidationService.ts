/**
 * ConfessionFlow - Deterministic Schedule Validation Service
 * The safety enforcement layer that guarantees AI recommendations NEVER
 * bypass platform boundaries, daily limits, active posting windows,
 * or controlled experimental overrides.
 */

import {
  GroqSchedulingRecommendation,
  MediaFormatType,
  StaleQueueRepairResult,
} from '@/types/growth';
import { Confession } from '@/types';
import { mockStore } from '@/lib/mockStore';
import { growthStore } from '@/lib/growthStore';
import { experimentService } from './experimentService';

const ACCOUNT_TIMEZONE = 'Asia/Kolkata';

export interface ValidatedScheduleResult {
  valid: boolean;
  status: 'VALIDATED' | 'ADJUSTED_FOR_SAFETY' | 'FALLBACK_BASELINE';
  targetTimestamp: string;
  targetFormat: MediaFormatType;
  cooldownMinutes: number;
  adjustments: string[];
  recommendation: GroqSchedulingRecommendation;
  experimentOverride?: {
    experimentId: string;
    variantId: string;
    factor: string;
  };
}

export class ScheduleValidationService {
  /**
   * Helper to format Date into Asia/Kolkata hour
   */
  private getHourInAccountTz(date: Date): number {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: ACCOUNT_TIMEZONE,
    }).format(date);
    const h = parseInt(hourStr, 10);
    return h === 24 ? 0 : h;
  }

  /**
   * Helper to format Date into YYYY-MM-DD in Asia/Kolkata
   */
  private getDateKeyInAccountTz(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: ACCOUNT_TIMEZONE,
    }).format(date);
  }

  /**
   * Validate and enforce deterministic safety rules on a recommendation
   */
  public async validateAndApplySafetyRules(
    recommendation: GroqSchedulingRecommendation,
    confession?: Confession
  ): Promise<ValidatedScheduleResult> {
    const adjustments: string[] = [];
    let status: ValidatedScheduleResult['status'] = 'VALIDATED';
    const settings = mockStore.getSettings();

    // 1. Initial targets from recommendation
    let targetFormat: MediaFormatType = recommendation.recommended_format || 'IMAGE';
    let targetTime = new Date(recommendation.recommended_next_publish_at);
    const now = new Date();

    // If recommendation provided an invalid date string, fall back to now + wait minutes
    if (isNaN(targetTime.getTime())) {
      const wait = recommendation.wait_before_publishing_minutes || 60;
      targetTime = new Date(now.getTime() + wait * 60000);
      adjustments.push(`Invalid timestamp in recommendation; defaulted to ${wait}m from now.`);
      status = 'ADJUSTED_FOR_SAFETY';
    }

    // 2. Cooldown bounds check
    const adminMinCooldown =
      (settings as any).min_post_spacing_minutes ??
      settings.auto_publish_interval_minutes ??
      settings.min_gap_minutes ??
      30;
    const recMinCooldown = recommendation.recommended_gap_minutes?.min || 45;
    const effectiveCooldown = Math.max(adminMinCooldown, recMinCooldown);

    // 3. Prevent past or immediate timestamps
    const minEarliestMs = now.getTime() + 5 * 60000; // at least 5 mins from now
    if (targetTime.getTime() < minEarliestMs) {
      targetTime = new Date(now.getTime() + effectiveCooldown * 60000);
      adjustments.push(`Recommended time was in the past or too immediate; shifted forward by ${effectiveCooldown}m.`);
      status = 'ADJUSTED_FOR_SAFETY';
    }

    // 4. Cooldown against previous published or scheduled posts
    const allConfessions = mockStore.getConfessions();
    const scheduledOrPublished = allConfessions.filter(
      (c) =>
        (c.status === 'PUBLISHED' && c.published_at) ||
        (c.status === 'SCHEDULED' && c.scheduled_at && (!confession || c.id !== confession.id))
    );

    let latestPriorTimestamp = 0;
    for (const c of scheduledOrPublished) {
      const tsStr = c.published_at || c.scheduled_at;
      if (tsStr) {
        const ms = new Date(tsStr).getTime();
        if (ms > latestPriorTimestamp) {
          latestPriorTimestamp = ms;
        }
      }
    }

    if (latestPriorTimestamp > 0) {
      const minRequiredMs = latestPriorTimestamp + effectiveCooldown * 60000;
      if (targetTime.getTime() < minRequiredMs) {
        targetTime = new Date(minRequiredMs);
        adjustments.push(`Spacing collision detected; enforced ${effectiveCooldown}m gap after previous post.`);
        status = 'ADJUSTED_FOR_SAFETY';
      }
    }

    // 5. Daily post cap check (Meta hard limit: 50/day, User setting: default 5)
    const dailyCap = Math.min(
      50,
      (settings as any).daily_post_cap ?? settings.max_daily_posts ?? 5
    );
    const targetDateKey = this.getDateKeyInAccountTz(targetTime);
    const postsOnTargetDay = allConfessions.filter((c) => {
      const ts = c.published_at || c.scheduled_at;
      if (!ts) return false;
      return this.getDateKeyInAccountTz(new Date(ts)) === targetDateKey;
    }).length;

    if (postsOnTargetDay >= dailyCap) {
      // Shift to next calendar day at active start hour (or 10:00 AM)
      const startHour = (settings as any).posting_start_hour ?? settings.auto_publish_start_hour ?? 10;
      const nextDay = new Date(targetTime.getTime() + 24 * 60 * 60000);
      nextDay.setHours(startHour, 0, 0, 0);
      targetTime = nextDay;
      adjustments.push(`Daily post limit reached (${postsOnTargetDay}/${dailyCap}); deferred to next active day.`);
      status = 'ADJUSTED_FOR_SAFETY';
    }

    // 6. Active Posting Hours enforcement
    const postingStartHour = (settings as any).posting_start_hour ?? settings.auto_publish_start_hour;
    const postingEndHour = (settings as any).posting_end_hour ?? settings.auto_publish_end_hour;
    if (typeof postingStartHour === 'number' && typeof postingEndHour === 'number') {
      const targetHour = this.getHourInAccountTz(targetTime);
      if (targetHour < postingStartHour) {
        targetTime.setHours(postingStartHour, 0, 0, 0);
        adjustments.push(`Target was before active start hour (${postingStartHour}:00); bumped to start hour.`);
        status = 'ADJUSTED_FOR_SAFETY';
      } else if (targetHour >= postingEndHour) {
        // Shift to next day start hour
        const nextDay = new Date(targetTime.getTime() + 24 * 60 * 60000);
        nextDay.setHours(postingStartHour, 0, 0, 0);
        targetTime = nextDay;
        adjustments.push(`Target was after active end hour (${postingEndHour}:00); deferred to next morning.`);
        status = 'ADJUSTED_FOR_SAFETY';
      }
    }

    // 7. Check Controlled Experiments Override
    let experimentOverride: ValidatedScheduleResult['experimentOverride'];
    try {
      const experiments = await growthStore.getExperiments();
      const activeExps = experiments.filter((e) => e.status === 'ACTIVE');

      for (const exp of activeExps) {
        if (exp.factor === 'CONTENT_FORMAT' && confession) {
          const asg = await experimentService.assignToExperiment(exp.id, confession);
          if (asg) {
            const variant = exp.variants.find((v) => v.id === asg.variant_id);
            if (variant?.config?.format_type) {
              targetFormat = variant.config.format_type;
              experimentOverride = {
                experimentId: exp.id,
                variantId: asg.variant_id,
                factor: 'CONTENT_FORMAT',
              };
              adjustments.push(`Controlled experiment '${exp.name}' active: assigned format ${targetFormat} (Variant ${asg.variant_id}).`);
              status = 'ADJUSTED_FOR_SAFETY';
              break;
            }
          }
        } else if (exp.factor === 'POSTING_TIME' && confession) {
          const asg = await experimentService.assignToExperiment(exp.id, confession);
          if (asg) {
            const variant = exp.variants.find((v) => v.id === asg.variant_id);
            if (variant?.config?.time_offset_minutes) {
              const offsetMs = Number(variant.config.time_offset_minutes) * 60000;
              targetTime = new Date(targetTime.getTime() + offsetMs);
              experimentOverride = {
                experimentId: exp.id,
                variantId: asg.variant_id,
                factor: 'POSTING_TIME',
              };
              adjustments.push(`Controlled experiment '${exp.name}' active: offset schedule by ${variant.config.time_offset_minutes}m (Variant ${asg.variant_id}).`);
              status = 'ADJUSTED_FOR_SAFETY';
              break;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[ScheduleValidationService] Experiment assignment check notice:', e?.message || e);
    }

    return {
      valid: true,
      status,
      targetTimestamp: targetTime.toISOString(),
      targetFormat,
      cooldownMinutes: effectiveCooldown,
      adjustments,
      recommendation,
      experimentOverride,
    };
  }

  /**
   * Repairs stale, overlapping, or past scheduled confessions in the queue
   * Canonical delegation to AdaptiveSchedulingEngine
   */
  public async repairStaleQueue(): Promise<StaleQueueRepairResult> {
    const { adaptiveSchedulingEngine } = await import('./adaptiveSchedulingEngine');
    return await adaptiveSchedulingEngine.repairQueue();
  }
}

export const scheduleValidationService = new ScheduleValidationService();
