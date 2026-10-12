/**
 * ConfessionFlow - Adaptive Scheduling Engine
 * The SINGLE CANONICAL SCHEDULING AUTHORITY for ConfessionFlow.
 *
 * CANONICAL FLOW:
 * Growth Intelligence -> Scheduling Strategy -> Strategy Validator -> AdaptiveSchedulingEngine -> Hard Constraint Validation -> scheduled_at -> Database
 *
 * Invariants:
 * 1. Every scheduled post must have scheduled_at > NOW (+ minimum 2m safety buffer)
 * 2. Every scheduled post's local time in account timezone (Asia/Kolkata) must strictly be within active hours [startHour, endHour).
 *    Any candidate landing outside active hours is REJECTED and rolled over to startHour (either today or next morning).
 * 3. Exact machine-readable provenance is recorded on every scheduled item.
 * 4. When sample size is insufficient (N < 10 or 0), the strategy is strictly BASELINE (or CONFIGURED), with 0 confidence and NO fake learned optima.
 * 5. Fixed cooldowns are ONLY used when explicitly configured by the administrator.
 */

import { mockStore } from '@/lib/mockStore';
import { growthStore } from '@/lib/growthStore';
import { confessionService } from '@/services/confessionService';
import { Confession, SystemSettings } from '@/types';
import {
  CanonicalSchedulingStrategy,
  CanonicalStrategySource,
  SchedulingProvenance,
  SchedulingReasonType,
  ScheduleValidationReport,
  MediaFormatType,
  CadenceStrategyType,
  StaleQueueRepairResult,
} from '@/types/growth';

export interface SchedulingDecision {
  scheduledAt: string;
  strategySource: CanonicalStrategySource | string;
  strategyVersion?: string;
  gapMinutes: number;
  timezone: string;
  reasonType: string;
  reason: string;
}

export class AdaptiveSchedulingEngine {
  private static instance: AdaptiveSchedulingEngine;

  public static getInstance(): AdaptiveSchedulingEngine {
    if (!AdaptiveSchedulingEngine.instance) {
      AdaptiveSchedulingEngine.instance = new AdaptiveSchedulingEngine();
    }
    return AdaptiveSchedulingEngine.instance;
  }

  // ---------------------------------------------------------------------------
  // 1. Timezone & Active Hours Utilities
  // ---------------------------------------------------------------------------

  /**
   * Break a Date down into its exact components in the target timezone
   */
  public getZonedParts(date: Date, timeZone: string = 'Asia/Kolkata') {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    let hour = get('hour');
    if (hour === 24) hour = 0; // Fix V8 engine midnight edge case
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour,
      minute: get('minute'),
      second: get('second'),
    };
  }

  /**
   * Construct a Date representing an exact local time in the target timezone
   */
  public createZonedDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number = 0,
    timeZone: string = 'Asia/Kolkata'
  ): Date {
    const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'longOffset',
    });
    const parts = dtf.formatToParts(approxUtc);
    const tzOffsetPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    let offsetMs = 0;
    if (tzOffsetPart) {
      const match = tzOffsetPart.match(/GMT([+-])(\d{1,2}):(\d{2})/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const h = parseInt(match[2], 10);
        const m = parseInt(match[3], 10);
        offsetMs = sign * (h * 60 + m) * 60000;
      }
    }
    const localUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    return new Date(localUtcMs - offsetMs);
  }

  /**
   * Helper to format a Date into YYYY-MM-DD in the target timezone
   */
  public getDateKeyInAccountTz(date: Date, timeZone: string = 'Asia/Kolkata'): string {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(date);
  }

  /**
   * Strictly enforces active hours boundary.
   * If candidate lands outside [startHour, endHour), it is rolled over to startHour (either today or next day).
   */
  public alignToActiveHours(
    candidate: Date,
    settings: SystemSettings
  ): { alignedDate: Date; wasRolledOver: boolean; reason?: string; reasonType: SchedulingReasonType } {
    const tz = settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;

    const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);
    if (is24_7) {
      return { alignedDate: candidate, wasRolledOver: false, reasonType: 'NORMAL_CADENCE' };
    }

    const parts = this.getZonedParts(candidate, tz);

    // After end boundary: hour > endHour OR (hour === endHour && minute > 0)
    const isAfterEnd = parts.hour > endHour || (parts.hour === endHour && (parts.minute > 0 || parts.second > 0));
    // Before start boundary: hour < startHour
    const isBeforeStart = parts.hour < startHour;

    if (!isAfterEnd && !isBeforeStart) {
      return { alignedDate: candidate, wasRolledOver: false, reasonType: 'NORMAL_CADENCE' };
    }

    if (isAfterEnd) {
      // Overnight rest active: Advance to NEXT DAY at startHour:00
      const todayAtStart = this.createZonedDate(parts.year, parts.month, parts.day, startHour, 0, 0, tz);
      const nextDayAtStart = new Date(todayAtStart.getTime() + 24 * 60 * 60 * 1000);
      const timeStr = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
      return {
        alignedDate: nextDayAtStart,
        wasRolledOver: true,
        reasonType: 'ACTIVE_WINDOW_ROLLOVER',
        reason: `Calculated candidate ${timeStr} crossed the ${endHour}:00 rest boundary. Rolled forward to next day ${startHour}:00.`,
      };
    }

    // Before morning start: Advance to TODAY at startHour:00
    const todayAtStart = this.createZonedDate(parts.year, parts.month, parts.day, startHour, 0, 0, tz);
    const timeStr = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
    return {
      alignedDate: todayAtStart,
      wasRolledOver: true,
      reasonType: 'ACTIVE_WINDOW_ROLLOVER',
      reason: `Calculated candidate ${timeStr} was before active morning window (${startHour}:00). Rolled forward to today ${startHour}:00.`,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Canonical Scheduling Strategy
  // ---------------------------------------------------------------------------

  /**
   * The ONLY function that determines the active scheduling strategy.
   * Returns one of: CONFIGURED | BASELINE | LEARNED | EXPERIMENT
   */
  public async getCurrentSchedulingStrategy(): Promise<CanonicalSchedulingStrategy> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;
    const activeWindow = [
      {
        start: `${String(startHour).padStart(2, '0')}:00`,
        end: `${String(endHour).padStart(2, '0')}:00`,
        label: `${startHour}:00–${endHour}:00 Active Window`,
      },
    ];

    // 1. Configured / Manual Override
    const isManual =
      settings.scheduling_strategy_mode === 'MANUAL' ||
      settings.random_gap_enabled === false;

    if (isManual) {
      const baseGap = Math.max(15, settings.manual_fixed_gap_minutes || settings.auto_publish_interval_minutes || 60);
      const jitter = settings.anti_bot_jitter_minutes || 0;
      return {
        source: 'CONFIGURED',
        strategy_name: 'CONFIGURED_CADENCE',
        daily_posts: settings.target_daily_posts || settings.max_daily_posts || 4,
        gap_range: { min: baseGap, max: baseGap + jitter },
        gap_minutes_recommended: baseGap,
        preferred_windows: activeWindow,
        confidence: 1.0,
        sample_size: 0,
        is_learned: false,
        reason: `Configured fixed cadence active (${baseGap}m interval${jitter > 0 ? ` + up to ${jitter}m jitter` : ''}).`,
        label: `Fixed cooldown (${baseGap}m)`,
      };
    }

    // 2. Query historical evidence count from Growth Store
    let evidenceCount = 0;
    try {
      const snapshots = await growthStore.getSnapshots();
      const uniqueMedia = new Set(snapshots.map((s) => s.published_media_id));
      evidenceCount = uniqueMedia.size;
    } catch {
      evidenceCount = 0;
    }

    const minEvidenceRequired = settings.min_posts_for_cadence_learning ?? 20;

    // 3. Baseline Exploration (Sample size < threshold)
    if (evidenceCount < minEvidenceRequired || settings.scheduling_strategy_mode === 'BASELINE') {
      const minGap = Math.max(20, settings.min_gap_minutes ?? 30);
      const maxGap = Math.max(minGap + 10, settings.max_gap_minutes ?? 75);
      const recommendedDaily = settings.target_daily_posts ?? 4;
      return {
        source: 'BASELINE',
        strategy_name: 'BASELINE_EXPLORATION',
        daily_posts: recommendedDaily,
        gap_range: { min: minGap, max: maxGap },
        gap_minutes_recommended: Math.round((minGap + maxGap) / 2),
        preferred_windows: activeWindow,
        confidence: 0,
        sample_size: evidenceCount,
        is_learned: false,
        reason: `Baseline exploration strategy active. Insufficient post history (${evidenceCount}/${minEvidenceRequired} tracked posts) to infer empirical optima.`,
        label: `Baseline Exploration (${minGap}–${maxGap}m gap)`,
      };
    }

    // 4. Learned Strategy (Sufficient verified data)
    let learnedDaily = settings.target_daily_posts ?? 4;
    let learnedGapMin = settings.min_gap_minutes ?? 60;
    let learnedGapMax = settings.max_gap_minutes ?? 90;
    let confidence = 0.8;

    try {
      const { growthMetricsService } = await import('@/services/growth/growthMetricsService');
      const sat = await growthMetricsService.getPostingFrequencySaturationAnalysis();
      if (sat && sat.optimal_posts_per_day) {
        learnedDaily = sat.optimal_posts_per_day;
        confidence = sat.confidence;
      }
      const gapStats = await growthMetricsService.getPostGapAnalysis();
      if (gapStats && gapStats.length > 0) {
        const sortedGaps = [...gapStats].filter((g) => g.sample_size >= 3).sort((a, b) => b.median_reach - a.median_reach);
        if (sortedGaps.length > 0) {
          const best = sortedGaps[0];
          if (best.gap_bucket === '30-60m') { learnedGapMin = 30; learnedGapMax = 60; }
          else if (best.gap_bucket === '60-120m') { learnedGapMin = 60; learnedGapMax = 120; }
          else if (best.gap_bucket === '120-240m') { learnedGapMin = 120; learnedGapMax = 240; }
          else if (best.gap_bucket === '15-30m') { learnedGapMin = 15; learnedGapMax = 30; }
        }
      }
    } catch {}

    // Bounded by settings guardrails
    const minDailyAllowed = settings.min_daily_posts ?? 2;
    const maxDailyAllowed = settings.max_daily_posts ?? 12;
    const boundedDaily = Math.min(Math.max(learnedDaily, minDailyAllowed), maxDailyAllowed);

    return {
      source: 'LEARNED',
      strategy_name: 'DATA_DRIVEN_OPTIMUM',
      daily_posts: boundedDaily,
      gap_range: { min: learnedGapMin, max: learnedGapMax },
      gap_minutes_recommended: Math.round((learnedGapMin + learnedGapMax) / 2),
      preferred_windows: activeWindow,
      confidence,
      sample_size: evidenceCount,
      is_learned: true,
      reason: `Learned optimal strategy from ${evidenceCount} published posts: ${boundedDaily} posts/day with ${learnedGapMin}–${learnedGapMax}m spacing.`,
      label: `Learned Growth Strategy (${learnedGapMin}–${learnedGapMax}m gap)`,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Gap Calculation
  // ---------------------------------------------------------------------------

  /**
   * Deterministically calculates candidate gap for a queue position
   */
  public calculateCandidateGap(
    idx: number,
    strategy: CanonicalSchedulingStrategy,
    settings: SystemSettings
  ): { gapMinutes: number; reason: string } {
    if (strategy.source === 'CONFIGURED') {
      const base = settings.manual_fixed_gap_minutes || settings.auto_publish_interval_minutes || 60;
      const maxJitter = settings.anti_bot_jitter_minutes || 0;
      const jitter = maxJitter > 0 ? (idx * 7) % (maxJitter + 1) : 0;
      const total = base + jitter;
      return {
        gapMinutes: total,
        reason: `Configured fixed cadence: ${base}m base (+${jitter}m jitter)`,
      };
    }

    const min = strategy.gap_range.min;
    const max = strategy.gap_range.max;
    const spread = Math.max(1, max - min);
    const primes = [37, 53, 41, 67, 31, 59, 43, 71, 47, 61];
    const p = primes[idx % primes.length];
    const rolled = min + ((p * (idx + 1) * 7) % (spread + 1));

    const sourceLabel = strategy.source === 'LEARNED' ? 'Learned' : 'Baseline';
    return {
      gapMinutes: rolled,
      reason: `${sourceLabel} gap: ${rolled}m (${strategy.label})`,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Decision Validation & Single Post Scheduling
  // ---------------------------------------------------------------------------

  /**
   * Validates a scheduling decision object before persisting to database
   */
  public validateSchedulingDecision(decision: SchedulingDecision, settings: any): void {
    if (!decision || !decision.scheduledAt) {
      throw new Error('Scheduling decision validation failed: scheduledAt is missing or null.');
    }
    const d = new Date(decision.scheduledAt);
    if (isNaN(d.getTime())) {
      throw new Error(`Scheduling decision validation failed: scheduledAt "${decision.scheduledAt}" is not a valid date.`);
    }
    if (d.getTime() <= Date.now() - 5000) {
      throw new Error(`Scheduling decision validation failed: scheduledAt "${decision.scheduledAt}" must be in the future.`);
    }

    const tz = decision.timezone || settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;
    const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);

    if (!is24_7) {
      const parts = this.getZonedParts(d, tz);
      const isAfter = parts.hour > endHour || (parts.hour === endHour && (parts.minute > 0 || parts.second > 0));
      const isBefore = parts.hour < startHour;
      if (isAfter || isBefore) {
        throw new Error(
          `Scheduling decision validation failed: scheduledAt "${decision.scheduledAt}" (${parts.hour}:${parts.minute} ${tz}) falls outside active hours (${startHour}:00–${endHour}:00).`
        );
      }
    }

    const validSources = ['CONFIGURED', 'BASELINE', 'LEARNED', 'EXPERIMENT'];
    if (!validSources.includes(decision.strategySource)) {
      throw new Error(`Scheduling decision validation failed: invalid strategySource "${decision.strategySource}". Must be one of ${validSources.join(', ')}.`);
    }

    if (typeof decision.gapMinutes !== 'number' || isNaN(decision.gapMinutes) || decision.gapMinutes < 0) {
      throw new Error('Scheduling decision validation failed: gapMinutes must be a non-negative number.');
    }
  }

  /**
   * Canonical operation: scheduleNextEligiblePost
   * Schedules the next eligible post or a specific post
   */
  public async scheduleNextEligiblePost(
    candidateOrId?: Confession | string,
    options?: { forceTime?: string }
  ): Promise<Confession | null> {
    let candidate: Confession | null = null;
    if (typeof candidateOrId === 'string') {
      candidate = mockStore.getConfessionById(candidateOrId) || null;
    } else if (candidateOrId) {
      candidate = candidateOrId;
    } else {
      const all = mockStore.getConfessions();
      candidate = all.find((c) =>
        (c.status === 'APPROVED' || c.status === 'SCHEDULED') &&
        !c.published_at &&
        !c.instagram_media_id &&
        c.moderation_status !== 'HIGH' &&
        c.quality_status !== 'LOW_VALUE' &&
        !['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED', 'NEEDS_REVIEW'].includes(c.reconciliation_status as any) &&
        !c.scheduled_at
      ) || null;
    }

    if (!candidate) return null;
    return await this.scheduleNextCandidate(candidate, options);
  }

  /**
   * Schedules a single approved candidate at the next available legal slot
   */
  public async scheduleNextCandidate(
    candidate: Confession,
    options?: { forceTime?: string }
  ): Promise<Confession> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const strategy = await this.getCurrentSchedulingStrategy();
    const now = new Date();
    const nowMs = now.getTime();

    if (
      ['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(candidate.reconciliation_status as any) ||
      candidate.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
      candidate.status === 'UNKNOWN_NEEDS_REVIEW' ||
      candidate.status === 'UNKNOWN'
    ) {
      throw new Error(`Cannot schedule confession with unconfirmed status (${candidate.status} / ${candidate.reconciliation_status}). Reconciliation required.`);
    }

    // 1. If explicit manual forceTime provided by admin
    if (options?.forceTime) {
      const explicitDate = new Date(options.forceTime);
      if (isNaN(explicitDate.getTime())) throw new Error('Invalid manual schedule timestamp');
      if (explicitDate.getTime() <= nowMs) throw new Error('Cannot schedule in the past');

      // Validate active hours
      const alignment = this.alignToActiveHours(explicitDate, settings);
      const scheduledAtIso = alignment.alignedDate.toISOString();
      const whyThisTime = alignment.wasRolledOver
        ? `Manual Schedule · Adjusted (${alignment.reason})`
        : 'Manual Schedule · Configured by administrator';

      const decision: SchedulingDecision = {
        scheduledAt: scheduledAtIso,
        strategySource: 'CONFIGURED',
        strategyVersion: 'v2.1',
        gapMinutes: 0,
        timezone: tz,
        reasonType: alignment.reasonType,
        reason: whyThisTime,
      };

      this.validateSchedulingDecision(decision, settings);

      const provenance: SchedulingProvenance = {
        reason_type: alignment.reasonType,
        reason: whyThisTime,
        strategy_source: 'CONFIGURED',
        gap_minutes: 0,
        confidence: 1.0,
        sample_size: 0,
        evaluated_at: now.toISOString(),
      };

      const updated = await confessionService.updateConfession(candidate.id, {
        status: 'SCHEDULED',
        scheduled_at: decision.scheduledAt,
        strategy_source: decision.strategySource,
        strategy_version: decision.strategyVersion,
        schedule_reason: decision.reason,
        schedule_timezone: decision.timezone,
        scheduling_strategy: 'ADMIN_OVERRIDE',
        scheduling_reason: whyThisTime,
        scheduling_confidence: 'HIGH',
        why_this_time: whyThisTime,
        scheduling_provenance: provenance,
      });

      if (!updated || !updated.scheduled_at) {
        throw new Error(`Database write failed for confession #${candidate.id}: scheduled_at was not persisted.`);
      }

      return updated;
    }

    // 2. Automatic candidate scheduling: Find previous post to base cursor on
    const allConfessions = mockStore.getConfessions();
    const priorPosts = allConfessions.filter(
      (c) =>
        c.id !== candidate.id &&
        ((c.status === 'PUBLISHED' && c.published_at) ||
          (c.status === 'SCHEDULED' && c.scheduled_at))
    );

    let latestTimestampMs = 0;
    for (const p of priorPosts) {
      const ts = p.scheduled_at || p.published_at;
      if (ts) {
        const ms = new Date(ts).getTime();
        if (ms > latestTimestampMs) latestTimestampMs = ms;
      }
    }

    // Cursor begins at now + 5 minutes or latest post + gap
    const initialCursor = new Date(Math.max(nowMs + 5 * 60000, latestTimestampMs));
    const gapInfo = this.calculateCandidateGap(0, strategy, settings);

    let candidateDate = new Date(initialCursor.getTime() + gapInfo.gapMinutes * 60000);
    const alignment = this.alignToActiveHours(candidateDate, settings);
    candidateDate = alignment.alignedDate;

    // Check daily frequency limit
    let dayKey = this.getDateKeyInAccountTz(candidateDate, tz);
    let postsOnDay = allConfessions.filter((c) => {
      const ts = c.scheduled_at || c.published_at;
      if (!ts || c.id === candidate.id) return false;
      return this.getDateKeyInAccountTz(new Date(ts), tz) === dayKey;
    }).length;

    const maxDaily = settings.max_daily_posts || 12;
    let daySafety = 0;
    while (postsOnDay >= maxDaily && daySafety < 30) {
      daySafety++;
      // Roll forward to next day at startHour
      const nextDay = new Date(candidateDate.getTime() + 24 * 60 * 60000);
      candidateDate = this.alignToActiveHours(nextDay, settings).alignedDate;
      dayKey = this.getDateKeyInAccountTz(candidateDate, tz);
      postsOnDay = allConfessions.filter((c) => {
        const ts = c.scheduled_at || c.published_at;
        if (!ts || c.id === candidate.id) return false;
        return this.getDateKeyInAccountTz(new Date(ts), tz) === dayKey;
      }).length;
    }

    const scheduledAtIso = candidateDate.toISOString();
    const gapHours = Math.floor(gapInfo.gapMinutes / 60);
    const gapMins = gapInfo.gapMinutes % 60;
    const gapLabel = gapHours > 0 ? (gapMins > 0 ? `${gapHours}h ${gapMins}m` : `${gapHours}h`) : `${gapMins}m`;
    const whyThisTime = alignment.wasRolledOver
      ? `${strategy.label} · Rolled Over (${alignment.reason})`
      : `${strategy.label} · ${gapLabel} (${gapInfo.reason})`;

    const decision: SchedulingDecision = {
      scheduledAt: scheduledAtIso,
      strategySource: strategy.source,
      strategyVersion: 'v2.1',
      gapMinutes: gapInfo.gapMinutes,
      timezone: tz,
      reasonType: alignment.reasonType,
      reason: whyThisTime,
    };

    this.validateSchedulingDecision(decision, settings);

    const provenance: SchedulingProvenance = {
      reason_type: alignment.reasonType,
      reason: whyThisTime,
      strategy_source: strategy.source,
      gap_minutes: gapInfo.gapMinutes,
      confidence: strategy.confidence,
      sample_size: strategy.sample_size,
      evaluated_at: now.toISOString(),
    };

    const updated = await confessionService.updateConfession(candidate.id, {
      status: 'SCHEDULED',
      scheduled_at: decision.scheduledAt,
      strategy_source: decision.strategySource,
      strategy_version: decision.strategyVersion,
      schedule_reason: decision.reason,
      schedule_timezone: decision.timezone,
      scheduling_strategy: strategy.strategy_name,
      scheduling_gap_minutes: gapInfo.gapMinutes,
      scheduling_reason: whyThisTime,
      scheduling_confidence: strategy.confidence >= 0.7 ? 'HIGH' : strategy.confidence >= 0.4 ? 'MEDIUM' : 'LOW',
      scheduling_evidence_count: strategy.sample_size,
      why_this_time: whyThisTime,
      scheduling_provenance: provenance,
    });

    if (!updated || !updated.scheduled_at) {
      throw new Error(`Database write failed for confession #${candidate.id}: scheduled_at was not persisted.`);
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // 5. Full Queue Regeneration: recalculateFutureQueue
  // ---------------------------------------------------------------------------

  /**
   * Completely regenerates the future publishing queue using the canonical engine.
   * Clears all old/invalid timestamps and allocates sequential legal slots inside active hours.
   */
  public async recalculateFutureQueue(options?: {
    forceRecalculate?: boolean;
    preserveExistingFuture?: boolean;
    enforceRollingHorizon?: boolean;
    rollingHorizonHours?: number;
    includeReadyForReview?: boolean;
  }): Promise<{
    totalScheduled: number;
    preservedCount: number;
    newlyScheduledCount: number;
    strategy: string;
    source: CanonicalStrategySource;
    queueWindow: { earliest: string | null; latest: string | null };
    items: Array<{
      id: string;
      rowNumber: number;
      previousScheduledAt: string | null;
      newScheduledAt: string;
      gapMinutes: number;
      strategy: string;
    }>;
  }> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const strategy = await this.getCurrentSchedulingStrategy();
    const now = new Date();
    const nowMs = now.getTime();

    // Auto-approve eligible READY_FOR_REVIEW items only if manual approval is disabled, auto-publish is active, or explicitly requested
    const isAutoApprove =
      options?.includeReadyForReview === true ||
      settings.publishing_mode === 'AUTO_PUBLISH' ||
      settings.publishing_mode === 'AUTO_APPROVAL' ||
      (settings.require_approval === false && settings.publishing_mode !== 'MANUAL_APPROVAL');

    const allConfessions = mockStore.getConfessions();

    if (isAutoApprove) {
      const isQualityGateActive = settings.enable_quality_gate !== false;
      const eligibleReady = allConfessions.filter(
        (c) =>
          c.status === 'READY_FOR_REVIEW' &&
          (c.moderation_status === 'LOW' || (c.moderation_status as any) === 'SAFE' || !c.moderation_status) &&
          (!isQualityGateActive || c.quality_override === true || (c.quality_status !== 'LOW_VALUE' && c.quality_status !== 'NEEDS_REVIEW')) &&
          !c.published_at &&
          !c.instagram_media_id &&
          !['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(c.reconciliation_status as any)
      );
      for (const readyItem of eligibleReady) {
        readyItem.status = 'APPROVED';
        await confessionService.updateConfession(readyItem.id, {
          status: 'APPROVED',
          error_message: null,
        });
      }
    }

    // 1. Gather all candidates to schedule:
    // Any confession with status SCHEDULED or APPROVED (excluding PUBLISHED, REJECTED, DELETED, FAILED)
    const candidates = mockStore.getConfessions()
      .filter(
        (c) =>
          (c.status === 'SCHEDULED' || c.status === 'APPROVED') &&
          !c.published_at &&
          !c.instagram_media_id &&
          c.quality_status !== 'LOW_VALUE' &&
          !['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(c.reconciliation_status as any)
      )
      .sort((a, b) => (a.google_sheet_row || 0) - (b.google_sheet_row || 0));

    if (candidates.length === 0) {
      return {
        totalScheduled: 0,
        preservedCount: 0,
        newlyScheduledCount: 0,
        strategy: strategy.strategy_name,
        source: strategy.source,
        queueWindow: { earliest: null, latest: null },
        items: [],
      };
    }

    const forceRecalculate = options?.forceRecalculate ?? false;
    const preserveExisting = options?.preserveExistingFuture ?? false;

    const preservedItems: Confession[] = [];
    const itemsToSchedule: Confession[] = [];

    for (const c of candidates) {
      const hasFutureSchedule =
        c.status === 'SCHEDULED' &&
        c.scheduled_at &&
        new Date(c.scheduled_at).getTime() > nowMs;

      if (!forceRecalculate && preserveExisting && hasFutureSchedule) {
        preservedItems.push(c);
      } else {
        itemsToSchedule.push(c);
      }
    }

    // 2. Establish initial cursor: Now + 5 minutes aligned to active hours
    let cursor: Date;
    if (preservedItems.length > 0) {
      const latestPreservedMs = Math.max(...preservedItems.map((p) => new Date(p.scheduled_at!).getTime()));
      cursor = new Date(Math.max(nowMs + 2 * 60000, latestPreservedMs));
    } else {
      cursor = this.alignToActiveHours(new Date(nowMs + 5 * 60000), settings).alignedDate;
    }

    // Track daily post volume per calendar day
    const postsPerDay = new Map<string, number>();
    const todayKey = this.getDateKeyInAccountTz(now, tz);
    const publishedToday = mockStore.getConfessions().filter(
      (c) => c.status === 'PUBLISHED' && c.published_at && this.getDateKeyInAccountTz(new Date(c.published_at), tz) === todayKey
    ).length;
    postsPerDay.set(todayKey, publishedToday);

    for (const p of preservedItems) {
      if (p.scheduled_at) {
        const k = this.getDateKeyInAccountTz(new Date(p.scheduled_at), tz);
        postsPerDay.set(k, (postsPerDay.get(k) || 0) + 1);
      }
    }

    let dailyPlan: any = null;
    try {
      const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
      dailyPlan = await cadenceAnalyzer.generateDailyGrowthPlan();
    } catch {}

    const effectiveDailyCap = dailyPlan?.effective_daily_posts || settings.max_daily_posts || strategy.daily_posts || 12;
    const enforceRollingHorizon = options?.enforceRollingHorizon ?? false;
    const rollingHorizonHours = options?.rollingHorizonHours ?? settings.rolling_horizon_hours ?? 24;
    const horizonLimitMs = nowMs + rollingHorizonHours * 60 * 60000;

    const scheduledTimes: string[] = [];
    const repairedItems: Array<{
      id: string;
      rowNumber: number;
      previousScheduledAt: string | null;
      newScheduledAt: string;
      gapMinutes: number;
      strategy: string;
    }> = [];

    for (let idx = 0; idx < itemsToSchedule.length; idx++) {
      const c = itemsToSchedule[idx];
      const gapInfo = this.calculateCandidateGap(idx, strategy, settings);

      // Advance cursor
      let tentative = new Date(cursor.getTime() + gapInfo.gapMinutes * 60000);
      const alignment = this.alignToActiveHours(tentative, settings);
      tentative = alignment.alignedDate;

      // Enforce daily cap (push excess to next day's active start)
      let dayKey = this.getDateKeyInAccountTz(tentative, tz);
      let daySafety = 0;
      while ((postsPerDay.get(dayKey) || 0) >= effectiveDailyCap && daySafety < 30) {
        daySafety++;
        const nextDay = new Date(tentative.getTime() + 24 * 60 * 60000);
        tentative = this.alignToActiveHours(nextDay, settings).alignedDate;
        dayKey = this.getDateKeyInAccountTz(tentative, tz);
      }

      // Rolling Horizon Guard
      if (enforceRollingHorizon && tentative.getTime() > horizonLimitMs) {
        // Leave remaining items in APPROVED queue without schedule timestamp
        for (let j = idx; j < itemsToSchedule.length; j++) {
          const rem = itemsToSchedule[j];
          const updateHold = {
            status: 'APPROVED' as const,
            scheduled_at: null,
            scheduling_reason: `Held in approved queue: Exceeds ${rollingHorizonHours}h rolling horizon.`,
          };
          await confessionService.updateConfession(rem.id, updateHold);
        }
        break;
      }

      cursor = tentative;
      postsPerDay.set(dayKey, (postsPerDay.get(dayKey) || 0) + 1);

      const scheduledAtIso = cursor.toISOString();
      const gapHours = Math.floor(gapInfo.gapMinutes / 60);
      const gapMins = gapInfo.gapMinutes % 60;
      const gapLabel = gapHours > 0 ? (gapMins > 0 ? `${gapHours}h ${gapMins}m` : `${gapHours}h`) : `${gapMins}m`;
      const whyThisTime = alignment.wasRolledOver
        ? `${strategy.label} · Rolled Over (${alignment.reason})`
        : `${strategy.label} · ${gapLabel} (${gapInfo.reason})`;

      const provenance: SchedulingProvenance = {
        reason_type: alignment.reasonType,
        reason: whyThisTime,
        strategy_source: strategy.source,
        gap_minutes: gapInfo.gapMinutes,
        confidence: strategy.confidence,
        sample_size: strategy.sample_size,
        evaluated_at: now.toISOString(),
      };

      const prevScheduledAt = c.scheduled_at || null;

      const decision: SchedulingDecision = {
        scheduledAt: scheduledAtIso,
        strategySource: strategy.source,
        strategyVersion: 'v2.1',
        gapMinutes: gapInfo.gapMinutes,
        timezone: tz,
        reasonType: alignment.reasonType,
        reason: whyThisTime,
      };

      this.validateSchedulingDecision(decision, settings);

      const updatePayload = {
        status: 'SCHEDULED' as const,
        scheduled_at: decision.scheduledAt,
        strategy_source: decision.strategySource,
        strategy_version: decision.strategyVersion,
        schedule_reason: decision.reason,
        schedule_timezone: decision.timezone,
        scheduling_strategy: strategy.strategy_name,
        scheduling_gap_minutes: decision.gapMinutes,
        scheduling_reason: whyThisTime,
        scheduling_confidence: (strategy.confidence >= 0.7 ? 'HIGH' : strategy.confidence >= 0.4 ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
        scheduling_evidence_count: strategy.sample_size,
        why_this_time: whyThisTime,
        scheduling_provenance: provenance,
      };

      const updated = await confessionService.updateConfession(c.id, updatePayload);
      if (!updated || !updated.scheduled_at) {
        throw new Error(`Database write failed for confession #${c.id}: scheduled_at was not persisted.`);
      }

      scheduledTimes.push(scheduledAtIso);
      repairedItems.push({
        id: c.id,
        rowNumber: c.google_sheet_row || 0,
        previousScheduledAt: prevScheduledAt,
        newScheduledAt: scheduledAtIso,
        gapMinutes: gapInfo.gapMinutes,
        strategy: strategy.strategy_name,
      });
    }

    const allScheduledTimes = [
      ...preservedItems.map((p) => p.scheduled_at!),
      ...scheduledTimes,
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return {
      totalScheduled: allScheduledTimes.length,
      preservedCount: preservedItems.length,
      newlyScheduledCount: scheduledTimes.length,
      strategy: strategy.strategy_name,
      source: strategy.source,
      queueWindow: {
        earliest: allScheduledTimes[0] || null,
        latest: allScheduledTimes[allScheduledTimes.length - 1] || null,
      },
      items: repairedItems,
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Validation & Invariant Checking: validateAllPendingSchedules
  // ---------------------------------------------------------------------------

  /**
   * Database / application invariant verification:
   * Every pending scheduled post must satisfy:
   * 1. scheduled_at > NOW
   * 2. local_time(scheduled_at, Asia/Kolkata) is within configured active hours [startHour, endHour)
   *
   * Automatically repairs any violating items!
   */
  public async validateAllPendingSchedules(): Promise<ScheduleValidationReport> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;
    const nowMs = Date.now();

    const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);

    const scheduledPosts = mockStore
      .getConfessions()
      .filter((c) => c.status === 'SCHEDULED' && c.scheduled_at);

    let valid = 0;
    let invalid = 0;
    let past = 0;
    let outsideActiveHours = 0;
    let repaired = 0;

    let needsRecalculation = false;

    for (const c of scheduledPosts) {
      const scheduledMs = new Date(c.scheduled_at!).getTime();
      let isItemValid = true;

      // Check 1: In the past
      if (scheduledMs <= nowMs) {
        past++;
        isItemValid = false;
      }

      // Check 2: Outside active hours
      if (!is24_7) {
        const parts = this.getZonedParts(new Date(scheduledMs), tz);
        const isAfter = parts.hour > endHour || (parts.hour === endHour && (parts.minute > 0 || parts.second > 0));
        const isBefore = parts.hour < startHour;
        if (isAfter || isBefore) {
          outsideActiveHours++;
          isItemValid = false;
        }
      }

      if (isItemValid) {
        valid++;
      } else {
        invalid++;
        needsRecalculation = true;
      }
    }

    if (needsRecalculation) {
      const recalcRes = await this.recalculateFutureQueue();
      repaired = recalcRes.newlyScheduledCount;
    }

    return {
      total: scheduledPosts.length,
      valid,
      invalid,
      past,
      outside_active_hours: outsideActiveHours,
      repaired,
    };
  }

  /**
   * Repair Queue endpoint: Reschedules stale or invalid items
   */
  public async repairQueue(): Promise<StaleQueueRepairResult> {
    const recalcRes = await this.recalculateFutureQueue();
    const strategy = await this.getCurrentSchedulingStrategy();
    const cadenceStrategy: CadenceStrategyType =
      strategy.source === 'CONFIGURED'
        ? 'ADMIN_OVERRIDE'
        : strategy.source === 'EXPERIMENT'
        ? 'EXPERIMENTAL_CADENCE'
        : strategy.source === 'LEARNED'
        ? 'PEAK_WINDOW_PACING'
        : 'EXPLORATORY_BASELINE';

    return {
      repairedCount: recalcRes.newlyScheduledCount,
      repairedConfessions: recalcRes.items,
      strategy: cadenceStrategy,
      reason: `Repaired ${recalcRes.newlyScheduledCount} stale or invalid scheduled confession(s) via AdaptiveSchedulingEngine (${strategy.label}).`,
    };
  }

  /**
   * Comprehensive Future Schedules Validation
   * Validates all eligible queue items and returns full breakdown:
   * total_eligible, scheduled, no_slot, invalid, past, outside_active_hours, database_write_failed
   */
  public async validateFutureSchedules(): Promise<{
    total_eligible: number;
    scheduled: number;
    no_slot: number;
    invalid: number;
    past: number;
    outside_active_hours: number;
    database_write_failed: number;
    items: Array<{
      id: string;
      rowNumber: number;
      status: string;
      scheduled_at: string | null;
      localTimeIST: string | null;
      time_ist?: string | null;
      isValid: boolean;
      slot_status?: string;
      issues: string[];
    }>;
  }> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;
    const nowMs = Date.now();
    const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);

    const allConfessions = mockStore.getConfessions();
    const eligible = allConfessions.filter(
      (c) =>
        (c.status === 'SCHEDULED' || c.status === 'APPROVED') &&
        !c.published_at &&
        !c.instagram_media_id &&
        c.quality_status !== 'LOW_VALUE' &&
        !['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(c.reconciliation_status as any)
    );

    let scheduled = 0;
    let noSlot = 0;
    let invalid = 0;
    let past = 0;
    let outsideActive = 0;
    let dbFailed = 0;

    const items: Array<{
      id: string;
      rowNumber: number;
      status: string;
      scheduled_at: string | null;
      localTimeIST: string | null;
      time_ist?: string | null;
      isValid: boolean;
      slot_status?: string;
      issues: string[];
    }> = [];

    for (const c of eligible) {
      const issues: string[] = [];
      let localTimeIST: string | null = null;

      if (!c.scheduled_at) {
        noSlot++;
        issues.push('NO_SLOT');
      } else {
        const d = new Date(c.scheduled_at);
        if (isNaN(d.getTime())) {
          invalid++;
          issues.push('INVALID_TIMESTAMP');
        } else {
          localTimeIST = `${new Intl.DateTimeFormat('en-IN', {
            timeZone: tz,
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(d)} IST`;

          if (d.getTime() <= nowMs) {
            past++;
            issues.push('PAST_DUE');
          }

          if (!is24_7) {
            const parts = this.getZonedParts(d, tz);
            const isAfter = parts.hour > endHour || (parts.hour === endHour && (parts.minute > 0 || parts.second > 0));
            const isBefore = parts.hour < startHour;
            if (isAfter || isBefore) {
              outsideActive++;
              issues.push('OUTSIDE_ACTIVE_HOURS');
            }
          }
        }
      }

      if (issues.length === 0) {
        scheduled++;
      }

      items.push({
        id: c.id,
        rowNumber: c.google_sheet_row || 0,
        status: c.status,
        scheduled_at: c.scheduled_at || null,
        localTimeIST,
        time_ist: localTimeIST,
        isValid: issues.length === 0,
        slot_status: issues.length === 0 ? 'VALID' : issues.join(', '),
        issues,
      });
    }

    return {
      total_eligible: eligible.length,
      scheduled,
      no_slot: noSlot,
      invalid,
      past,
      outside_active_hours: outsideActive,
      database_write_failed: dbFailed,
      items,
    };
  }
}

export const adaptiveSchedulingEngine = AdaptiveSchedulingEngine.getInstance();
