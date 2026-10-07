import { confessionService } from './confessionService';
import { googleSheetsService } from './googleSheetsService';
import { moderationService } from './moderationService';
import { aiService } from './aiService';
import { mockStore } from '@/lib/mockStore';
import { Confession, ModerationRisk, ConfessionStatus, SystemSettings } from '@/types';
import { buildInstagramCaption } from '@/lib/paginationEngine';
import {
  CadenceStrategyType,
  SchedulingMode,
  MediaFormatType,
  PreferredPostingWindow,
  SchedulerRecommendation,
  StaleQueueRepairResult,
} from '@/types/growth';
import { confessionQualityService } from './quality/confessionQualityService';
import { validatePublishEligibility } from './quality/publishEligibilityService';
import { generateContentHash, normalizeConfessionText } from '@/lib/contentHash';

export interface AutoPublishCycleResult {
  ran: boolean;
  status:
    | 'SKIPPED'
    | 'SUCCESS'
    | 'RATE_LIMITED'
    | 'DAILY_LIMIT_REACHED'
    | 'NO_CANDIDATES'
    | 'OUTSIDE_HOURS'
    | 'ERROR';
  reason?: string;
  publishedConfessionId?: string;
  confessionNumber?: number;
  instagramPermalink?: string;
  error?: string;
}

export class SchedulingService {
  private isProcessingCron = false;
  private lastPublishedAtMs = 0;
  // Natural human anti-bot jitter (randomized between 0 and 30 minutes, creating 60m-90m natural intervals)
  private currentJitterMinutes = Math.floor(Math.random() * 30);

  public resetState(): void {
    this.isProcessingCron = false;
    this.lastPublishedAtMs = 0;
  }

  public async autoHealConfessions(): Promise<void> {
    try {
      // Quarantines confessions stuck in PUBLISHING >3m to UNKNOWN_NEEDS_REVIEW
      await confessionService.autoHealStuckConfessions();
      // DO NOT blindly reset FAILED or UNKNOWN confessions to APPROVED.
      // Retries require verified reconciliation or explicit administrative action.
    } catch (healErr) {
      console.warn('[SchedulingService] autoHealConfessions error:', healErr);
    }
  }

  /**
   * Run scheduled posts publisher check (called by /api/cron/publish-scheduled)
   */
  public async processDuePosts(force: boolean = false): Promise<{ published: string[]; errors: { id: string; error: string }[] }> {
    if (this.isProcessingCron) {
      console.log('[SchedulingService] Cron run already in progress, skipping concurrent trigger');
      return { published: [], errors: [] };
    }

    const settings = mockStore.getSettings();
    const envDisabled = process.env.AUTO_PUBLISH_ENABLED === 'false';
    const isAutoPublishActive = !envDisabled && settings.auto_publish === true && settings.publishing_mode === 'AUTO_PUBLISH';

    // Strictly halt scheduled automated publishing if user paused/turned off auto-publish (unless force override)
    if (!isAutoPublishActive && !force) {
      console.log('[SchedulingService] Auto-publish is paused (auto_publish is false or publishing_mode is not AUTO_PUBLISH). Skipping scheduled post processing.');
      return { published: [], errors: [] };
    }

    // Respect safe human daytime hours for scheduled posts (unless 24/7 mode is active or force)
    if (!force) {
      try {
        const startHour = settings.auto_publish_start_hour ?? 0;
        const endHour = settings.auto_publish_end_hour ?? 24;
        const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);

        if (!is24_7) {
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: settings.timezone || 'Asia/Kolkata',
            hour: 'numeric',
            hour12: false,
          });
          const currentHour = parseInt(formatter.format(new Date()), 10);
          const isWithinWindow = startHour < endHour
            ? (currentHour >= startHour && currentHour < endHour)
            : (currentHour >= startHour || currentHour < endHour);

          if (!isWithinWindow) {
            console.log(`[SchedulingService] Outside active human hours (${currentHour}:00, safe daytime window is ${startHour}:00 - ${endHour}:00). Resting account overnight.`);
            return { published: [], errors: [] };
          }
        }
      } catch {}
    }

    this.isProcessingCron = true;
    const published: string[] = [];
    const errors: { id: string; error: string }[] = [];

    try {
      await this.autoHealConfessions();
      const now = new Date();
      const allConfessions = (await confessionService.getConfessions({ status: 'SCHEDULED', limit: 50 })).confessions;

      // Filter posts where scheduled_at <= now
      const due = allConfessions.filter((c) => {
        if (!c.scheduled_at) return false;
        return new Date(c.scheduled_at) <= now;
      });

      console.log(`[SchedulingService] Found ${due.length} scheduled posts due for publishing.`);

      // Check daily post limit constraint
      const stats = await confessionService.getDashboardStats();
      if (stats.publishedToday >= stats.maxDailyPosts) {
        console.warn(`[SchedulingService] Daily publishing limit reached (${stats.publishedToday}/${stats.maxDailyPosts}). Halting automated batch.`);
        return { published, errors };
      }

      for (const post of due) {
        // Prevent exceeding daily cap
        if (stats.publishedToday + published.length >= stats.maxDailyPosts) {
          console.warn('[SchedulingService] Hit daily publishing cap during scheduled run.');
          break;
        }

        try {
          await confessionService.publishConfession(post.id);
          published.push(post.id);
          this.lastPublishedAtMs = Date.now();
          // Space out due posts organically instead of blasting them all simultaneously
          break;
        } catch (err: any) {
          errors.push({ id: post.id, error: err?.message || 'Failed' });
        }
      }

      return { published, errors };
    } finally {
      this.isProcessingCron = false;
    }
  }

  /**
   * Run automated Google Sheet sync (called by /api/cron/sync)
   */
  public async syncGoogleSheet(): Promise<{ imported: number; processed: number }> {
    const config = mockStore.getGoogleSheetConfig();
    const rows = await googleSheetsService.fetchRows(config);

    // Load existing confessions from both stores to have complete visibility
    const mockConfessions = mockStore.getConfessions();
    let dbConfessions: Confession[] = [];
    const useSupabase = process.env.DISABLE_SUPABASE !== 'true' &&
      process.env.USE_SUPABASE !== 'false' &&
      process.env.MOCK_EXTERNAL_APIS !== 'true' &&
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

    if (useSupabase) {
      try {
        const allPages = await confessionService.getConfessions({ limit: 1000 });
        dbConfessions = allPages.confessions || [];
      } catch (err) {
        console.warn('[SchedulingService] Failed to load confessions from Supabase for sync:', err);
      }
    }

    const existing = [...mockConfessions, ...dbConfessions];

    // Combine deleted rows from ALL sources:
    // 1) Explicitly saved deletedRowNumbers in mockStore
    // 2) Any confession in existing list with status === 'DELETED'
    const deletedRowNumbers = new Set<number>([
      ...mockStore.getDeletedRowNumbers(),
      ...(existing.filter((c) => c.status === 'DELETED').map((c) => c.google_sheet_row).filter(Boolean) as number[]),
    ]);

    const existingRowSet = new Set(
      existing.map((c) => c.google_sheet_row).filter(Boolean)
    );

    const newConfessions: Confession[] = [];
    const now = new Date();

    for (const row of rows) {
      // 1. Guard against re-importing any row explicitly deleted by user
      if (deletedRowNumbers.has(row.rowNumber)) {
        continue;
      }

      const rawStatus = (row.status || '').trim().toUpperCase();
      const isAlreadyPublished = rawStatus === 'PUBLISHED' || rawStatus === 'POSTED';
      const isRejected = rawStatus === 'REJECTED';
      const isScheduled = rawStatus === 'SCHEDULED';
      const isDeletedInSheet = rawStatus === 'DELETED';

      if (isDeletedInSheet) {
        if (!deletedRowNumbers.has(row.rowNumber)) {
          deletedRowNumbers.add(row.rowNumber);
          try {
            mockStore.setDeletedRowNumbers(Array.from(deletedRowNumbers));
          } catch {}
        }
        continue;
      }

      // If row already exists in memory, sync any updated status from the sheet (e.g. if marked PUBLISHED or REJECTED)
      if (existingRowSet.has(row.rowNumber)) {
        const existingConf = existing.find((c) => c.google_sheet_row === row.rowNumber);
        if (existingConf && existingConf.status === 'DELETED') {
          // Already in Deleted section, ignore
          continue;
        }

        // DATABASE IS AUTHORITATIVE: If DB already knows this post is PUBLISHED, DB wins.
        // If sheet erroneously shows FAILED or empty, restore PUBLISHED on Google Sheet!
        if (existingConf && existingConf.status === 'PUBLISHED') {
          if (!isAlreadyPublished) {
            googleSheetsService.updateRowStatus(config, row.rowNumber, {
              status: 'PUBLISHED',
              processedAt: existingConf.published_at || new Date().toISOString(),
              postId: existingConf.instagram_media_id || '',
              instagramUrl: existingConf.instagram_permalink || '',
              error: '',
            }).catch(() => {});
          }
          continue;
        }

        if (isAlreadyPublished) {
          if (existingConf && existingConf.status !== 'PUBLISHED') {
            const updatePayload = {
              status: 'PUBLISHED' as ConfessionStatus,
              published_at: row.processedAt || existingConf.published_at || new Date().toISOString(),
              instagram_media_id: row.postId || existingConf.instagram_media_id || 'sheet-imported-published',
              reconciliation_status: 'RECONCILED' as const,
              reconciliation_notes: 'Synchronized from Google Sheet marked PUBLISHED.',
            };
            if (useSupabase) {
              confessionService.updateConfession(existingConf.id, updatePayload).catch(() => {});
            } else {
              mockStore.updateConfession(existingConf.id, updatePayload);
            }
          }
        } else if (isRejected) {
          if (existingConf && existingConf.status !== 'REJECTED') {
            if (useSupabase) {
              confessionService.updateConfession(existingConf.id, { status: 'REJECTED' }).catch(() => {});
            } else {
              mockStore.updateConfession(existingConf.id, { status: 'REJECTED' });
            }
          }
        }
        continue;
      }

      if (!row.confession || row.confession.trim().length === 0) {
        continue;
      }

      const newId = `confession-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // In-memory safety analysis & PII masking
      const currentSettings = mockStore.getSettings();
      const enablePii = currentSettings.enable_pii_detection !== false;
      const moderationResult = moderationService.analyzeContent(row.confession, enablePii);
      const cleanedText = enablePii
        ? moderationService.maskSensitiveInformation(row.confession, moderationResult.piiDetected)
        : row.confession;

      const normHash = generateContentHash(cleanedText);

      // Check if this identical confession was already published
      const alreadyPublishedWithHash = existing.find(
        (c) =>
          c.status === 'PUBLISHED' &&
          (c.normalized_content_hash === normHash || c.content_hash === normHash)
      );

      const isFailed = rawStatus === 'FAILED' || rawStatus === 'FAILED_CONFIRMED' || rawStatus === 'FAILED_REQUIRES_ACTION';
      const isUnknown = rawStatus === 'UNKNOWN' || rawStatus === 'UNKNOWN_NEEDS_REVIEW';

      const isAnon = row.isAnonymous !== undefined 
        ? row.isAnonymous 
        : ((row.name || '').toLowerCase() === 'anonymous' || !row.name);

      const displayName = isAnon ? 'Anonymous' : (row.name || 'Anonymous');

      // 2. Confession Quality Gate Evaluation
      const qualityResult = await confessionQualityService.evaluateConfession(cleanedText, {
        existingPool: existing.map((c) => ({
          id: c.id,
          row: c.google_sheet_row,
          text: c.cleaned_text || c.original_text,
        })),
        confessionId: newId,
      });

      let initialStatus: ConfessionStatus;
      if (alreadyPublishedWithHash) {
        initialStatus = 'DUPLICATE_ALREADY_PUBLISHED';
      } else if (isAlreadyPublished) {
        initialStatus = 'PUBLISHED';
      } else if (isRejected) {
        initialStatus = 'REJECTED';
      } else if (isScheduled) {
        initialStatus = 'SCHEDULED';
      } else if (isFailed || isUnknown) {
        // CRITICAL: NEVER import a FAILED or UNKNOWN row from the sheet as READY_FOR_REVIEW!
        initialStatus = 'UNKNOWN_NEEDS_REVIEW';
      } else if (
        currentSettings.auto_reject_low_value !== false &&
        qualityResult.qualityStatus === 'LOW_VALUE'
      ) {
        initialStatus = 'REJECTED';
      } else {
        initialStatus = 'READY_FOR_REVIEW';
      }

      const newConfession: Confession = {
        id: newId,
        google_sheet_id: config.spreadsheet_id,
        google_sheet_name: config.sheet_name,
        google_sheet_row: row.rowNumber,
        name: row.name || 'Anonymous',
        original_text: row.confession,
        cleaned_text: cleanedText,
        display_name: displayName,
        is_anonymous: isAnon,
        status: initialStatus,
        content_hash: normHash,
        normalized_content_hash: normHash,
        duplicate_of_id: alreadyPublishedWithHash?.id ?? null,
        duplicate_of_row: alreadyPublishedWithHash?.google_sheet_row ?? null,
        duplicate_of_permalink: alreadyPublishedWithHash?.instagram_permalink ?? null,
        reconciliation_status: alreadyPublishedWithHash
          ? 'RECONCILED'
          : isAlreadyPublished
          ? 'RECONCILED'
          : (isFailed || isUnknown)
          ? 'NEEDS_REVIEW'
          : null,
        reconciliation_notes: alreadyPublishedWithHash
          ? `Duplicate of published confession #${alreadyPublishedWithHash.google_sheet_row || alreadyPublishedWithHash.id}`
          : (isFailed || isUnknown)
          ? 'Imported from Google Sheet with failed/unknown status. Quarantined for reconciliation.'
          : null,
        moderation_status: moderationResult.risk,
        moderation_reason: moderationResult.reasons.length > 0 
          ? moderationResult.reasons.join('; ') 
          : 'Passed safety validation.',
        ai_processed: false,
        template_id: '44444444-4444-4444-4444-444444444444',
        generated_image_url: null,
        generated_image_path: null,
        caption: buildInstagramCaption({
          confessionNumber: row.rowNumber,
          hashtags: ['#confession', '#campuslife', '#studentconfessions'],
          mode: 'auto',
        }),
        hashtags: ['#confession', '#campuslife', '#studentconfessions'],
        scheduled_at: null,
        published_at: isAlreadyPublished ? (row.processedAt || row.timestamp || new Date().toISOString()) : null,
        instagram_media_id: isAlreadyPublished ? (row.postId || 'sheet-imported-published') : null,
        instagram_permalink: isAlreadyPublished ? (row.instagramUrl || null) : null,
        retry_count: 0,
        error_message: null,
        // Quality Gate metadata
        quality_status: qualityResult.qualityStatus,
        quality_score: qualityResult.qualityScore,
        quality_decision: qualityResult.decision,
        quality_intent: qualityResult.intent,
        quality_reason: qualityResult.reason,
        quality_category: qualityResult.category,
        quality_confidence: qualityResult.confidence,
        quality_model_version: qualityResult.modelVersion,
        quality_prompt_version: qualityResult.promptVersion,
        quality_rules_version: qualityResult.rulesVersion,
        quality_analyzed_at: qualityResult.analyzedAt,
        created_at: new Date(now.getTime() - (rows.length - row.rowNumber) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      };

      // If auto-rejected due to low value, sync status back to Google Sheets without deleting the row
      if (initialStatus === 'REJECTED' && qualityResult.qualityStatus === 'LOW_VALUE') {
        googleSheetsService
          .updateRowStatus(config, row.rowNumber, {
            status: 'REJECTED',
            error: `Low-value content: ${qualityResult.reason}`,
          })
          .catch(() => {});
      }

      newConfessions.push(newConfession);
      existingRowSet.add(row.rowNumber);
    }

    if (newConfessions.length > 0) {
      // Always store in mockStore so local file cache is never empty
      mockStore.addConfessions(newConfessions);

      if (useSupabase) {
        // Also sync new rows to Supabase if configured
        for (const confession of newConfessions) {
          await confessionService.createConfession(confession as any).catch((err: any) => {
            console.warn('[SchedulingService] Failed to insert confession to Supabase:', err?.message);
          });
        }
      }
    }

    // Update sheet connection sync state
    mockStore.updateGoogleSheetConfig({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'SUCCESS',
      rows_imported: (config.rows_imported || 0) + newConfessions.length,
    });

    mockStore.addLog({
      action: 'SHEET_SYNC',
      entity_type: 'sheet',
      metadata: { imported: newConfessions.length, totalInSheet: rows.length },
    });

    // If publishing mode is AUTO_APPROVAL or AUTO_PUBLISH, auto-approve low risk submissions
    const settings = mockStore.getSettings();
    if (settings.publishing_mode === 'AUTO_APPROVAL' || settings.publishing_mode === 'AUTO_PUBLISH' || settings.auto_publish) {
      await this.autoApproveEligibleConfessions();
    }

    return { imported: newConfessions.length, processed: newConfessions.length };
  }

  /**
   * Run fully autonomous auto-publishing cycle:
   * 1. Checks if any explicit SCHEDULED posts are due.
   * 2. Verifies auto_publish is active.
   * 3. Verifies active hours window (e.g. 09:00 - 23:00).
   * 4. Enforces daily post limit.
   * 5. Enforces post spacing cooldown (e.g. 1-2 hours between posts).
   * 6. Selects next eligible safe confession (FIFO).
   * 7. Prepares AI enhancements and image card.
   * 8. Publishes to Instagram and writes back to Google Sheet.
   */
  public async processAutoPublishCycle(force: boolean = false): Promise<AutoPublishCycleResult> {
    if (this.isProcessingCron) {
      console.log('[AutoPublisher] Cron run already in progress, skipping concurrent cycle');
      return { ran: false, status: 'SKIPPED', reason: 'A publishing cycle is already in progress' };
    }

    const settings = mockStore.getSettings();
    const envDisabled = process.env.AUTO_PUBLISH_ENABLED === 'false';
    const isAutoPublishActive = !envDisabled && settings.auto_publish === true && settings.publishing_mode === 'AUTO_PUBLISH';

    // 1. If auto_publish is not enabled and not forced, strictly halt all automated publishing
    if (!isAutoPublishActive && !force) {
      if (settings.publishing_mode === 'AUTO_APPROVAL') {
        await this.autoApproveEligibleConfessions();
      }
      return {
        ran: false,
        status: 'SKIPPED',
        reason: 'Auto-publish is not active (set publishing mode to Full Auto-Publish or toggle Auto-Publish ON)',
      };
    }

    // 2. Check if any explicitly SCHEDULED posts are due right now
    try {
      const scheduledRes = await this.processDuePosts(force);
      if (scheduledRes.published.length > 0) {
        return {
          ran: true,
          status: 'SUCCESS',
          publishedConfessionId: scheduledRes.published[0],
          reason: `Published ${scheduledRes.published.length} scheduled post(s) that reached their due date.`,
        };
      }
    } catch (err: any) {
      console.error('[AutoPublisher] Error processing due scheduled posts:', err?.message || err);
    }

    this.isProcessingCron = true;

    // 0. Auto-heal any stuck confessions before running cycle
    await this.autoHealConfessions();

    let candidate: Confession | undefined;

    try {
      const stats = await confessionService.getDashboardStats();

      // 3. Daily volume guard (Enforces Daily Growth Plan & settings hard limits)
      let dailyPlan: any = null;
      try {
        const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
        dailyPlan = await cadenceAnalyzer.generateDailyGrowthPlan();
      } catch (dpErr: any) {
        console.warn('[AutoPublisher] Failed to query daily growth plan:', dpErr?.message || dpErr);
      }

      const maxDaily = settings.max_daily_posts || 24;
      const effectiveDailyCap = dailyPlan ? dailyPlan.effective_daily_posts : maxDaily;

      if ((stats.publishedToday >= effectiveDailyCap || stats.publishedToday >= maxDaily) && !force) {
        const cap = stats.publishedToday >= maxDaily ? maxDaily : effectiveDailyCap;
        const authorityLabel = dailyPlan ? `Authority: ${dailyPlan.authority_source}` : `Cap: ${cap}`;
        console.warn(`[AutoPublisher] Daily post limit reached (${stats.publishedToday}/${cap}, ${authorityLabel}). Resting account until tomorrow.`);
        return {
          ran: false,
          status: 'DAILY_LIMIT_REACHED',
          reason: `Daily post cap reached (${stats.publishedToday}/${cap}). Account is resting until next daily window (${authorityLabel}).`,
        };
      }

      // 4. Active hours window guard (unless forced manually via button or in 24/7 mode)
      if (!force) {
        try {
          const startHour = settings.auto_publish_start_hour ?? 0;
          const endHour = settings.auto_publish_end_hour ?? 24;
          const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);

          if (!is24_7) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: settings.timezone || 'Asia/Kolkata',
              hour: 'numeric',
              hour12: false,
            });
            const currentHour = parseInt(formatter.format(new Date()), 10);
            const isWithinWindow = startHour < endHour
              ? (currentHour >= startHour && currentHour < endHour)
              : (currentHour >= startHour || currentHour < endHour);

            if (!isWithinWindow) {
              console.log(`[AutoPublisher] Outside active human hours (${currentHour}:00, window is ${startHour}:00 - ${endHour}:00). Resting account.`);
              return {
                ran: false,
                status: 'OUTSIDE_HOURS',
                reason: `Outside active human hours (${currentHour}:00 in ${settings.timezone || 'Asia/Kolkata'}). Safe daytime window is ${startHour}:00 - ${endHour}:00. Overnight account rest active.`,
              };
            }
          }
        } catch {
          // If timezone formatting fails, proceed safely
        }
      }

      // 4b. Post Saturation & Velocity Observation Guard (unless forced)
      if (!force) {
        try {
          const { postSaturationService } = await import('@/services/growth/postSaturationService');
          const satEval = await postSaturationService.evaluateSaturation();
          if (satEval.hasRecentPost && satEval.shouldDelayNextPost && satEval.isAccelerating) {
            console.log(`[AutoPublisher] Post saturation hold active (${satEval.reason}). Next check in ${satEval.recommendedWaitMinutes}m.`);
            return {
              ran: false,
              status: 'RATE_LIMITED',
              reason: `Post spacing cooldown active (saturation hold: ${satEval.reason})`,
            };
          }
        } catch (satErr: any) {
          console.warn('[AutoPublisher] Post saturation evaluation error, proceeding:', satErr?.message || satErr);
        }
      }

      // 5. Cadence Strategy & Post Spacing Guard (Growth Intelligence as primary input)
      let cadenceRec: SchedulerRecommendation | null = null;
      try {
        const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
        cadenceRec = await cadenceAnalyzer.getCadenceRecommendation();
      } catch (err: any) {
        console.warn('[AutoPublisher] Failed to query Growth Intelligence cadence:', err?.message || err);
      }

      const isRandomGap = settings.random_gap_enabled !== false;
      const minGap = Math.max(25, settings.min_gap_minutes ?? 30);
      const maxGap = Math.max(minGap + 5, settings.max_gap_minutes ?? 75);

      let effectiveIntervalMinutes: number;
      let jitter = 0;
      let baseInterval = 60;

      if (!isRandomGap) {
        // Explicit jitter test mode or fixed interval mode (preserves compatibility with Test 6)
        baseInterval = Math.max(45, settings.auto_publish_interval_minutes || 60);
        const maxJitter = settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30;
        let storedJitter = settings.current_jitter_minutes;
        if (storedJitter === undefined || storedJitter === null || isNaN(storedJitter)) {
          storedJitter = maxJitter > 0 ? Math.floor(Math.random() * (maxJitter + 1)) : 0;
          mockStore.updateSettings({ current_jitter_minutes: storedJitter });
        }
        jitter = storedJitter;
        this.currentJitterMinutes = jitter;
        effectiveIntervalMinutes = baseInterval + jitter;
      } else if (cadenceRec && cadenceRec.mode === 'manual') {
        // MODE 4: MANUAL OVERRIDE
        effectiveIntervalMinutes = cadenceRec.recommendedGapRangeMinutes.min;
      } else {
        // RANDOM GAP (Growth Optimized or Baseline)
        let rolledGap = settings.current_random_gap_minutes;
        if (!rolledGap || rolledGap < minGap || rolledGap > maxGap) {
          if (cadenceRec && cadenceRec.mode === 'growth_optimized') {
            const recMin = Math.max(minGap, cadenceRec.recommendedGapRangeMinutes.min);
            const recMax = Math.min(maxGap, cadenceRec.recommendedGapRangeMinutes.max);
            const effMin = Math.min(recMin, recMax);
            rolledGap = Math.floor(Math.random() * (recMax - effMin + 1)) + effMin;
            console.log(`[AutoPublisher] Growth-Optimized cadence active (${rolledGap}m gap, Strategy: ${cadenceRec.strategy}, Confidence: ${cadenceRec.confidence}, Evidence: N=${cadenceRec.evidenceCount}).`);
          } else {
            rolledGap = Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
          }
          mockStore.updateSettings({ current_random_gap_minutes: rolledGap });
        }
        effectiveIntervalMinutes = rolledGap;
      }

      const minIntervalMs = effectiveIntervalMinutes * 60 * 1000;

      // In-memory guard check
      if (!force && this.lastPublishedAtMs > 0) {
        const elapsedSinceLastRun = Date.now() - this.lastPublishedAtMs;
        if (elapsedSinceLastRun < minIntervalMs) {
          const remainingMinutes = Math.ceil((minIntervalMs - elapsedSinceLastRun) / 60000);
          console.log(`[AutoPublisher] Cooldown active (${Math.floor(elapsedSinceLastRun / 60000)}m since last run, ${isRandomGap ? `Organic Random Gap: ${effectiveIntervalMinutes}m` : `Anti-Bot Natural Jitter: +${jitter}m, dynamic gap: ${effectiveIntervalMinutes}m`}). Next post in ${remainingMinutes}m.`);
          return {
            ran: false,
            status: 'RATE_LIMITED',
            reason: isRandomGap
              ? `Post spacing cooldown active (Organic Random Gap: ${effectiveIntervalMinutes}m). Last post was ${Math.floor(elapsedSinceLastRun / 60000)}m ago. Next post permitted in ${remainingMinutes}m.`
              : `Post spacing cooldown active (Anti-Bot Natural Jitter: +${jitter}m applied). Last post was ${Math.floor(elapsedSinceLastRun / 60000)}m ago. Natural human gap is ${effectiveIntervalMinutes}m. Next post permitted in ${remainingMinutes}m.`,
          };
        }
      }

      const allConfessions = mockStore.getConfessions();
      const publishedPosts = allConfessions
        .filter((c) => c.status === 'PUBLISHED' && c.published_at)
        .map((c) => new Date(c.published_at!).getTime());

      const publishedLog = mockStore.getPublishedPosts()
        .filter((p) => p.published_at)
        .map((p) => new Date(p.published_at).getTime());

      const allTimes = [...publishedPosts, ...publishedLog, this.lastPublishedAtMs].filter((t) => t > 0);

      if (!force && allTimes.length > 0) {
        const mostRecentPublishMs = Math.max(...allTimes);
        const elapsedMs = Date.now() - mostRecentPublishMs;
        if (elapsedMs < minIntervalMs) {
          const remainingMinutes = Math.ceil((minIntervalMs - elapsedMs) / 60000);
          console.log(`[AutoPublisher] Cooldown active (${Math.floor(elapsedMs / 60000)}m since last post, ${isRandomGap ? `Organic Random Gap: ${effectiveIntervalMinutes}m` : `Anti-Bot Natural Jitter: +${jitter}m, dynamic gap: ${effectiveIntervalMinutes}m`}). Next post in ${remainingMinutes}m.`);
          return {
            ran: false,
            status: 'RATE_LIMITED',
            reason: isRandomGap
              ? `Post spacing cooldown active (Organic Random Gap: ${effectiveIntervalMinutes}m). Last post was ${Math.floor(elapsedMs / 60000)}m ago. Next post permitted in ${remainingMinutes}m.`
              : `Post spacing cooldown active (Anti-Bot Natural Jitter: +${jitter}m applied). Last post was ${Math.floor(elapsedMs / 60000)}m ago. Natural human gap is ${effectiveIntervalMinutes}m. Next post permitted in ${remainingMinutes}m.`,
          };
        }
      }

      // 6. Re-fetch fresh confessions after initial healing
      const freshConfessions = mockStore.getConfessions();

      const allowedRisks: ModerationRisk[] =
        settings.risk_threshold === 'HIGH'
          ? ['LOW', 'MEDIUM', 'HIGH']
          : settings.risk_threshold === 'MEDIUM'
          ? ['LOW', 'MEDIUM']
          : ['LOW'];

      // Prioritize strictly APPROVED, READY_FOR_REVIEW (in auto-publish mode), or unposted SCHEDULED confessions in FIFO row order
      const isAutoPublishMode = settings.publishing_mode === 'AUTO_PUBLISH' || settings.auto_publish || force;
      const eligibleCandidates = freshConfessions
        .filter(
          (c) =>
            c.status !== 'PUBLISHED' &&
            c.status !== 'REJECTED' &&
            c.status !== 'DELETED' &&
            c.status !== 'PUBLISHING' &&
            c.status !== 'FAILED' &&
            c.status !== 'FAILED_CONFIRMED' &&
            c.status !== 'FAILED_REQUIRES_ACTION' &&
            c.status !== 'UNKNOWN' &&
            c.status !== 'UNKNOWN_NEEDS_REVIEW' &&
            c.status !== 'DUPLICATE_ALREADY_PUBLISHED' &&
            c.status !== 'CANCELLED' &&
            (c.status === 'APPROVED' || (isAutoPublishMode && c.status === 'READY_FOR_REVIEW') || (c.status === 'SCHEDULED' && !c.published_at && !c.instagram_media_id)) &&
            allowedRisks.includes(c.moderation_status) &&
            !c.instagram_media_id &&
            !c.published_at &&
            validatePublishEligibility(c, settings).isEligible
        )
        .sort((a, b) => {
          // Strict FIFO sequence by Google Sheet row number (#035, #036, #037...)
          return (a.google_sheet_row || 0) - (b.google_sheet_row || 0);
        });

      if (eligibleCandidates.length === 0) {
        console.log('[AutoPublisher] No eligible safe confessions found to auto-publish.');
        return {
          ran: false,
          status: 'NO_CANDIDATES',
          reason: 'No eligible safe confessions in queue. (High-risk or already published confessions are skipped).',
        };
      }

      // Rank candidates using ContentScoringService (predicted performance score + aging fairness)
      let selectedCandidate = eligibleCandidates[0];
      try {
        const { contentScoringService } = await import('@/services/growth/contentScoringService');
        const minThreshold = settings.content_quality_threshold ?? 55;
        const rankedCandidates = await contentScoringService.rankCandidates(eligibleCandidates, minThreshold);
        if (rankedCandidates.length > 0) {
          selectedCandidate = rankedCandidates[0].confession;
          selectedCandidate.predicted_performance_score = rankedCandidates[0].predictedPerformanceScore;
        }
      } catch (scoreErr: any) {
        console.warn('[AutoPublisher] Content scoring ranking warning:', scoreErr?.message || scoreErr);
      }

      candidate = selectedCandidate;

      console.log(`[AutoPublisher] Selected confession #${selectedCandidate.google_sheet_row} (ID: ${selectedCandidate.id}${selectedCandidate.predicted_performance_score ? `, Score: ${selectedCandidate.predicted_performance_score}` : ''}) for auto-publishing.`);

      // Lock candidate immediately to prevent concurrent re-selection
      await confessionService.updateConfession(selectedCandidate.id, { status: 'PUBLISHING' });

      // 6b. Groq AI Duplicate Detection against all already published posts
      const previousPosts = allConfessions
        .filter((c) => c.status === 'PUBLISHED' && c.id !== selectedCandidate.id)
        .map((c) => ({
          row: c.google_sheet_row || 0,
          text: c.cleaned_text || c.original_text,
          id: c.id,
        }));

      if (previousPosts.length > 0) {
        console.log(`[AutoPublisher] Running Groq AI duplicate detection for #${candidate.google_sheet_row} against ${previousPosts.length} published post(s)...`);
        const dupCheck = await aiService.checkDuplicateWithGroq(
          candidate.cleaned_text || candidate.original_text,
          previousPosts
        );

        if (dupCheck.isDuplicate && dupCheck.confidence >= 0.75) {
          console.warn(`[AutoPublisher] ⚠️ Groq AI detected confession #${candidate.google_sheet_row} as DUPLICATE of #${dupCheck.duplicateOfRow} (${Math.round(dupCheck.confidence * 100)}% confidence): ${dupCheck.reason}`);

          // Mark candidate as REJECTED so it is never published
          await confessionService.rejectConfession(
            candidate.id,
            `AI Duplicate Detection: Duplicate of confession #${dupCheck.duplicateOfRow} (${dupCheck.reason})`
          );

          // Update Google Sheet with REJECTED
          const sheetConfig = mockStore.getGoogleSheetConfig();
          if (candidate.google_sheet_row) {
            await googleSheetsService.updateRowStatus(sheetConfig, candidate.google_sheet_row, {
              status: 'REJECTED',
              error: `AI Duplicate: Matches #${dupCheck.duplicateOfRow}`,
            });
          }

          mockStore.addLog({
            action: 'REJECTED',
            entity_type: 'confession',
            entity_id: candidate.id,
            metadata: {
              reason: 'AI_DUPLICATE_DETECTED',
              duplicateOfRow: dupCheck.duplicateOfRow,
              confidence: dupCheck.confidence,
              explanation: dupCheck.reason,
            },
          });

          // Automatically proceed to next eligible candidate
          console.log('[AutoPublisher] Duplicate skipped; advancing immediately to next candidate in line...');
          return await this.processAutoPublishCycle(force);
        }
      }

      // 7. Auto-prepare AI content & image if not done
      if (!candidate.ai_processed || !candidate.generated_image_url) {
        console.log(`[AutoPublisher] Running AI enhancement and rendering image card for #${candidate.google_sheet_row}...`);
        try {
          await confessionService.processConfession(candidate.id);
        } catch (procErr: any) {
          console.warn(`[AutoPublisher] AI pre-processing warning: ${procErr?.message || procErr}, proceeding to publish`);
        }
      }

      // 8. Publish confession to Instagram
      console.log(`[AutoPublisher] Publishing confession #${candidate.google_sheet_row} to Instagram...`);
      const publishedConfession = await confessionService.publishConfession(candidate.id);
      this.lastPublishedAtMs = Date.now();
      // Rotate gap for next post according to active strategy
      let nextGap = effectiveIntervalMinutes;
      if (!isRandomGap) {
        const nextMaxJitter = settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30;
        const nextJitter = nextMaxJitter > 0 ? Math.floor(Math.random() * (nextMaxJitter + 1)) : 0;
        this.currentJitterMinutes = nextJitter;
        nextGap = baseInterval + nextJitter;
        mockStore.updateSettings({ current_jitter_minutes: nextJitter });
      } else if (cadenceRec && cadenceRec.mode === 'growth_optimized') {
        const recMin = Math.max(minGap, cadenceRec.recommendedGapRangeMinutes.min);
        const recMax = Math.min(maxGap, cadenceRec.recommendedGapRangeMinutes.max);
        const effMin = Math.min(recMin, recMax);
        nextGap = Math.floor(Math.random() * (recMax - effMin + 1)) + effMin;
        mockStore.updateSettings({ current_random_gap_minutes: nextGap });
        console.log(`[AutoPublisher] Rolled next Growth-Optimized gap: ${nextGap}m (range: ${recMin}m–${recMax}m, Strategy: ${cadenceRec.strategy}).`);
      } else {
        nextGap = Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
        mockStore.updateSettings({ current_random_gap_minutes: nextGap });
        console.log(`[AutoPublisher] Rolled next organic random gap: ${nextGap}m (range: ${minGap}m–${maxGap}m).`);
      }

      mockStore.addLog({
        action: 'AUTO_PUBLISHED',
        entity_type: 'confession',
        entity_id: candidate.id,
        metadata: {
          row: candidate.google_sheet_row,
          permalink: publishedConfession.instagram_permalink,
          mediaId: publishedConfession.instagram_media_id,
          schedulingStrategy: cadenceRec?.strategy || (isRandomGap ? 'EXPLORATORY_BASELINE' : 'JITTER_BASELINE'),
          schedulingMode: cadenceRec?.mode || (isRandomGap ? 'baseline' : 'manual'),
          schedulingReason: cadenceRec?.reason,
          confidence: cadenceRec?.confidence || 'LOW',
          evidenceCount: cadenceRec?.evidenceCount || 0,
          effectiveIntervalMinutes: effectiveIntervalMinutes,
          nextIntervalMinutes: nextGap,
        },
      });

      console.log(`🎉 [AutoPublisher] Confession #${candidate.google_sheet_row} auto-published successfully! URL: ${publishedConfession.instagram_permalink}`);

      return {
        ran: true,
        status: 'SUCCESS',
        publishedConfessionId: candidate.id,
        confessionNumber: candidate.google_sheet_row,
        instagramPermalink: publishedConfession.instagram_permalink || undefined,
        reason: `Successfully auto-published confession #${candidate.google_sheet_row} to Instagram.`,
      };
    } catch (err: any) {
      console.error('[AutoPublisher] Error during auto-publish cycle:', err?.message || err);
      if (candidate && candidate.id) {
        try {
          const fresh = mockStore.getConfessionById(candidate.id);
          if (fresh && fresh.status === 'PUBLISHING') {
            await confessionService.updateConfession(candidate.id, {
              status: 'APPROVED',
              error_message: err?.message || 'Publishing cycle interrupted',
            });
          }
        } catch {}
      }
      return {
        ran: false,
        status: 'ERROR',
        error: err?.message || 'Auto-publish cycle failed',
      };
    } finally {
      this.isProcessingCron = false;
    }
  }

  /**
   * Auto-approve safe low-risk confessions without publishing them immediately
   */
  public async autoApproveEligibleConfessions(): Promise<number> {
    const confessions = mockStore.getConfessions();
    const settings = mockStore.getSettings();
    const toApprove = confessions.filter((c) => {
      if (c.status !== 'READY_FOR_REVIEW' || c.moderation_status !== 'LOW') {
        return false;
      }
      // Quality Gate check: Never auto-approve LOW_VALUE or NEEDS_REVIEW without override
      if (settings.enable_quality_gate !== false && c.quality_override !== true) {
        if (c.quality_status === 'LOW_VALUE' || c.quality_status === 'NEEDS_REVIEW') {
          return false;
        }
      }
      return true;
    });
    let count = 0;
    for (const c of toApprove) {
      try {
        await confessionService.approveConfession(c.id);
        count++;
      } catch {}
    }
    if (count > 0) {
      console.log(`[AutoPublisher] Auto-approved ${count} low-risk confessions.`);
    }
    return count;
  }

  /**
   * Helper to format a Date as YYYY-MM-DD in the target timezone
   */
  private getDayKey(date: Date, tz: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const year = parts.find((p) => p.type === 'year')?.value || '1970';
      const month = parts.find((p) => p.type === 'month')?.value || '01';
      const day = parts.find((p) => p.type === 'day')?.value || '01';
      return `${year}-${month}-${day}`;
    } catch {
      return date.toISOString().split('T')[0];
    }
  }

  /**
   * Align target posting timestamp to safe daytime hours (e.g. 09:00 - 22:00 in account timezone)
   * Prevents posting during late night / overnight hours and shifts to startHour next morning.
   */
  public alignToActiveHours(
    targetDate: Date,
    settings: SystemSettings,
    _preferredWindows?: PreferredPostingWindow[]
  ): Date {
    const tz = settings.timezone || 'Asia/Kolkata';
    const startHour = settings.auto_publish_start_hour ?? 0;
    const endHour = settings.auto_publish_end_hour ?? 24;

    const is24_7 = (startHour === 0 && endHour >= 24) || (startHour === endHour) || (startHour === 0 && endHour === 0);
    if (is24_7) {
      return targetDate;
    }

    let candidate = new Date(targetDate.getTime());

    for (let step = 0; step < 48; step++) {
      let hour: number;
      let mins: number;
      try {
        const hourStr = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: 'numeric',
          hour12: false,
        }).format(candidate);
        hour = parseInt(hourStr, 10);

        const minStr = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          minute: 'numeric',
        }).format(candidate);
        mins = parseInt(minStr, 10) || 0;
      } catch {
        hour = candidate.getHours();
        mins = candidate.getMinutes();
      }

      if (hour >= startHour && hour < endHour) {
        break;
      }

      if (hour >= endHour) {
        // Post lands during overnight rest. Roll forward to next day's active start hour
        const advanceHours = 24 - hour + startHour;
        const advanceMs = (advanceHours * 60 - mins) * 60 * 1000;
        candidate = new Date(candidate.getTime() + advanceMs);
      } else if (hour < startHour) {
        // Post lands in early morning before active start hour. Advance to startHour today
        const advanceHours = startHour - hour;
        const advanceMs = (advanceHours * 60 - mins) * 60 * 1000;
        candidate = new Date(candidate.getTime() + advanceMs);
      }
    }

    return candidate;
  }

  /**
   * Adaptive Schedule Generator:
   * Generates or repairs the upcoming publishing queue using Growth Intelligence recommendations.
   * - Reconciles Settings hard limits vs Growth Intelligence performance strategy
   * - Applies sample-size-gated cadence intervals & format/category awareness
   * - Enforces daily post limits and rolling 12–24h horizon
   */
  public async generateFutureSchedule(options?: {
    forceRecalculate?: boolean;
    preserveExistingFuture?: boolean;
    enforceRollingHorizon?: boolean;
    rollingHorizonHours?: number;
  }): Promise<ScheduleGenerationResult> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const forceRecalculate = options?.forceRecalculate ?? false;
    const preserveExisting = options?.preserveExistingFuture ?? true;

    const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
    const rec = await cadenceAnalyzer.getCadenceRecommendation();

    // Query authoritative Daily Growth Plan
    let dailyPlan: any = null;
    try {
      dailyPlan = await cadenceAnalyzer.generateDailyGrowthPlan();
    } catch (dpErr) {
      console.warn('[SchedulingService] Failed to query daily growth plan for schedule generation:', dpErr);
    }

    const effectiveDailyCap = dailyPlan ? dailyPlan.effective_daily_posts : (settings.max_daily_posts || 24);
    const enforceRollingHorizon = options?.enforceRollingHorizon ?? false;
    const horizonHours = options?.rollingHorizonHours ?? settings.rolling_horizon_hours ?? 24;

    await this.autoHealConfessions();
    const allConfessions = mockStore.getConfessions();
    const now = new Date();
    const nowMs = now.getTime();
    const horizonLimitMs = nowMs + horizonHours * 60 * 60 * 1000;

    // Eligible candidates for scheduled queue: strictly only APPROVED or already SCHEDULED
    const eligible = allConfessions.filter(
      (c) =>
        (c.status === 'APPROVED' || c.status === 'SCHEDULED') &&
        !c.published_at &&
        !c.instagram_media_id
    );

    const preservedItems: Confession[] = [];
    const itemsToSchedule: Confession[] = [];

    for (const c of eligible) {
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

    // If any item that needs scheduling has an earlier row number than preserved items,
    // merge them together so earlier submissions (#028) are NEVER leapfrogged by later ones (#051)!
    const minScheduleRow = itemsToSchedule.length > 0 ? Math.min(...itemsToSchedule.map((c) => c.google_sheet_row || 0)) : Infinity;
    const maxPreservedRow = preservedItems.length > 0 ? Math.max(...preservedItems.map((c) => c.google_sheet_row || 0)) : -Infinity;

    if (minScheduleRow < maxPreservedRow) {
      itemsToSchedule.push(...preservedItems);
      preservedItems.length = 0;
    }

    // Sort strictly in FIFO order by Google Sheet row number initially
    itemsToSchedule.sort((a, b) => (a.google_sheet_row || 0) - (b.google_sheet_row || 0));

    // When QUALITY_FIRST mode is active, rank items using ContentScoringService
    try {
      const { contentScoringService } = await import('@/services/growth/contentScoringService');
      const minThreshold = settings.content_quality_threshold ?? 50;
      const scoredRanked = await contentScoringService.rankCandidates(itemsToSchedule, minThreshold);
      if (scoredRanked.length > 0) {
        const rankedIds = new Set(scoredRanked.map((s) => s.confession.id));
        const orderedItems = [
          ...scoredRanked.map((s) => {
            const conf = s.confession;
            conf.predicted_performance_score = s.predictedPerformanceScore;
            return conf;
          }),
          ...itemsToSchedule.filter((c) => !rankedIds.has(c.id)),
        ];
        itemsToSchedule.length = 0;
        itemsToSchedule.push(...orderedItems);
      }
    } catch (scoreErr: any) {
      console.warn('[SchedulingService] Content scoring ranking warning:', scoreErr?.message || scoreErr);
    }

    // Track daily post volume across days to enforce daily limit
    const postsPerDay = new Map<string, number>();

    // Count already published posts for today
    const todayKey = this.getDayKey(now, tz);
    const publishedToday = allConfessions.filter(
      (c) => c.status === 'PUBLISHED' && c.published_at && this.getDayKey(new Date(c.published_at), tz) === todayKey
    ).length;
    postsPerDay.set(todayKey, publishedToday);

    // Count preserved items in postsPerDay
    for (const p of preservedItems) {
      if (p.scheduled_at) {
        const k = this.getDayKey(new Date(p.scheduled_at), tz);
        postsPerDay.set(k, (postsPerDay.get(k) || 0) + 1);
      }
    }

    // Starting cursor for new schedule slots
    let cursor: Date;
    if (preservedItems.length > 0) {
      const latestPreservedMs = Math.max(
        ...preservedItems.map((p) => new Date(p.scheduled_at!).getTime())
      );
      cursor = new Date(Math.max(nowMs + 2 * 60 * 1000, latestPreservedMs));
    } else {
      cursor = this.alignToActiveHours(new Date(nowMs + 5 * 60 * 1000), settings, rec.preferredWindows);
    }

    // Post Saturation & Velocity Guard: If recent post is actively accelerating, delay initial cursor
    try {
      const { postSaturationService } = await import('@/services/growth/postSaturationService');
      const satEval = await postSaturationService.evaluateSaturation();
      if (satEval.hasRecentPost && satEval.shouldDelayNextPost && satEval.isAccelerating) {
        const waitMs = satEval.recommendedWaitMinutes * 60 * 1000;
        const delayedTime = nowMs + waitMs;
        if (delayedTime > cursor.getTime()) {
          cursor = this.alignToActiveHours(new Date(delayedTime), settings, rec.preferredWindows);
        }
      }
    } catch {}

    const scheduledResults: Array<{
      id: string;
      google_sheet_row?: number;
      scheduled_at: string;
      strategy: CadenceStrategyType;
      gap_minutes: number;
      reason?: string;
    }> = [];

    let lastRolledGap = 0;
    for (let idx = 0; idx < itemsToSchedule.length; idx++) {
      const c = itemsToSchedule[idx];
      const format: MediaFormatType = c.slides && c.slides.length > 1 ? 'CAROUSEL' : 'IMAGE';
      const category = (c as any).content_category || undefined;

      const isFixed = settings.random_gap_enabled === false || settings.scheduling_strategy_mode === 'MANUAL' || rec.mode === 'manual';
      let gapInfo: { min: number; max: number; rolledGap: number; reason: string };

      if (isFixed) {
        const base = settings.scheduling_strategy_mode === 'MANUAL'
          ? Math.max(15, settings.manual_fixed_gap_minutes || settings.auto_publish_interval_minutes || 60)
          : Math.max(15, settings.auto_publish_interval_minutes || 180);
        const maxJitter = settings.scheduling_strategy_mode === 'MANUAL'
          ? 0
          : (settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30);
        const jitter = maxJitter > 0 ? (idx * 7) % (maxJitter + 1) : 0;
        gapInfo = {
          min: base,
          max: base + maxJitter,
          rolledGap: base + jitter,
          reason: `Fixed cooldown: ${base}m base (+${jitter}m jitter)`,
        };
      } else {
        gapInfo = cadenceAnalyzer.calculateEffectiveGap(rec, format, category);

        // Prevent adjacent identical gaps (e.g. 70m, 70m) to guarantee organic human variation
        if (gapInfo.rolledGap === lastRolledGap && gapInfo.max > gapInfo.min) {
          gapInfo.rolledGap = Math.floor(Math.random() * (gapInfo.max - gapInfo.min + 1)) + gapInfo.min;
          if (gapInfo.rolledGap === lastRolledGap) {
            gapInfo.rolledGap = gapInfo.rolledGap > gapInfo.min ? gapInfo.rolledGap - 5 : gapInfo.rolledGap + 5;
          }
        }
      }
      lastRolledGap = gapInfo.rolledGap;

      // Advance cursor by the evidence-backed interval
      let tentativeCursor = new Date(cursor.getTime() + gapInfo.rolledGap * 60 * 1000);
      tentativeCursor = this.alignToActiveHours(tentativeCursor, settings, rec.preferredWindows);

      // Enforce daily cap (pushing excess posts to next day's active hours)
      let dayKey = this.getDayKey(tentativeCursor, tz);
      let daySafety = 0;
      while ((postsPerDay.get(dayKey) || 0) >= effectiveDailyCap && daySafety < 30) {
        daySafety++;
        tentativeCursor = new Date(tentativeCursor.getTime() + 24 * 60 * 60 * 1000);
        tentativeCursor = this.alignToActiveHours(tentativeCursor, settings, rec.preferredWindows);
        dayKey = this.getDayKey(tentativeCursor, tz);
      }

      // Rolling Horizon Guard: If enforceRollingHorizon is enabled and slot exceeds rolling window
      if (enforceRollingHorizon && tentativeCursor.getTime() > horizonLimitMs) {
        console.log(`[SchedulingService] Rolling horizon reached (${horizonHours}h limit). Halting future slot allocation. Remaining items remain in APPROVED queue.`);
        // Revert remaining unassigned items to APPROVED
        for (let j = idx; j < itemsToSchedule.length; j++) {
          const rem = itemsToSchedule[j];
          if (rem.status === 'SCHEDULED' || rem.scheduled_at) {
            await confessionService.updateConfession(rem.id, {
              status: 'APPROVED',
              scheduled_at: null,
              scheduling_reason: `Held in approved queue: Exceeds ${horizonHours}h rolling horizon. Scheduled as rolling window advances.`,
            });
          }
        }
        break;
      }

      cursor = tentativeCursor;
      postsPerDay.set(dayKey, (postsPerDay.get(dayKey) || 0) + 1);

      const scheduledAtIso = cursor.toISOString();
      const isGrowthOptimized = !isFixed && rec.mode === 'growth_optimized';
      const gapHours = Math.floor(gapInfo.rolledGap / 60);
      const gapMins = gapInfo.rolledGap % 60;
      const gapLabel = gapHours > 0 ? (gapMins > 0 ? `${gapHours}h ${gapMins}m` : `${gapHours}h`) : `${gapMins}m`;
      const strategyLabel = isFixed ? 'Fixed cooldown' : isGrowthOptimized ? 'Growth optimized' : 'Random fallback';
      const whyThisTime = `${strategyLabel} · ${gapLabel} (${gapInfo.reason || rec.strategy})`;

      await confessionService.updateConfession(c.id, {
        status: 'SCHEDULED',
        scheduled_at: scheduledAtIso,
        scheduling_strategy: isFixed ? 'ADMIN_OVERRIDE' : rec.strategy,
        scheduling_gap_minutes: gapInfo.rolledGap,
        scheduling_reason: gapInfo.reason,
        scheduling_confidence: isFixed ? 'HIGH' : rec.confidence,
        scheduling_evidence_count: isFixed ? 0 : rec.evidenceCount,
        experiment_id: isFixed ? undefined : rec.experimentId,
        predicted_performance_score: c.predicted_performance_score,
        why_this_time: whyThisTime,
      });

      scheduledResults.push({
        id: c.id,
        google_sheet_row: c.google_sheet_row,
        scheduled_at: scheduledAtIso,
        strategy: isFixed ? 'ADMIN_OVERRIDE' : rec.strategy,
        gap_minutes: gapInfo.rolledGap,
        reason: gapInfo.reason,
      });
    }

    const allScheduledTimes = [
      ...preservedItems.map((p) => p.scheduled_at!),
      ...scheduledResults.map((s) => s.scheduled_at),
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return {
      totalScheduled: allScheduledTimes.length,
      preservedCount: preservedItems.length,
      newlyScheduledCount: scheduledResults.length,
      strategy: rec.strategy,
      mode: rec.mode,
      recommendationId: rec.id,
      queueWindow: {
        earliest: allScheduledTimes[0] || null,
        latest: allScheduledTimes[allScheduledTimes.length - 1] || null,
      },
      items: scheduledResults,
    };
  }

  /**
   * Primary Queue Schedule Generator enforcing Rolling Horizon (12–24h)
   */
  public async generateQueueSchedule(options?: {
    forceRecalculate?: boolean;
    preserveExistingFuture?: boolean;
    enforceRollingHorizon?: boolean;
    rollingHorizonHours?: number;
  }): Promise<ScheduleGenerationResult> {
    return this.generateFutureSchedule({
      enforceRollingHorizon: true,
      ...options,
    });
  }

  /**
   * Stale Queue Repair:
   * Reschedules past-due scheduled items (scheduled_at <= now) using current Growth Intelligence strategy
   * starting from now. Strictly preserves FIFO ordering and avoids arbitrary shifts.
   */
  public async repairStaleQueue(): Promise<StaleQueueRepairResult> {
    const now = new Date();
    const nowMs = now.getTime();
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const maxDaily = settings.max_daily_posts || 24;

    const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
    const rec = await cadenceAnalyzer.getCadenceRecommendation();

    const allConfessions = mockStore.getConfessions();
    const stalePosts = allConfessions
      .filter((c) => c.status === 'SCHEDULED' && c.scheduled_at && new Date(c.scheduled_at).getTime() <= nowMs)
      .sort(
        (a, b) =>
          new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime() ||
          (a.google_sheet_row || 0) - (b.google_sheet_row || 0)
      );

    if (stalePosts.length === 0) {
      return {
        repairedCount: 0,
        repairedConfessions: [],
        strategy: rec.strategy,
        reason: 'Queue has no stale posts scheduled in the past.',
      };
    }

    const futureScheduled = allConfessions
      .filter((c) => c.status === 'SCHEDULED' && c.scheduled_at && new Date(c.scheduled_at).getTime() > nowMs)
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

    let cursor = this.alignToActiveHours(new Date(nowMs + 2 * 60 * 1000), settings, rec.preferredWindows);
    const repairedConfessions: StaleQueueRepairResult['repairedConfessions'] = [];

    // Track posts per day
    const postsPerDay = new Map<string, number>();
    const todayKey = this.getDayKey(now, tz);
    const publishedToday = allConfessions.filter(
      (c) => c.status === 'PUBLISHED' && c.published_at && this.getDayKey(new Date(c.published_at), tz) === todayKey
    ).length;
    postsPerDay.set(todayKey, publishedToday);

    for (const c of stalePosts) {
      const format: MediaFormatType = c.slides && c.slides.length > 1 ? 'CAROUSEL' : 'IMAGE';
      const category = (c as any).content_category || undefined;

      const isFixed = settings.random_gap_enabled === false || settings.scheduling_strategy_mode === 'MANUAL' || rec.mode === 'manual';
      let gapInfo: { min: number; max: number; rolledGap: number; reason: string };

      if (isFixed) {
        const base = settings.scheduling_strategy_mode === 'MANUAL'
          ? Math.max(15, settings.manual_fixed_gap_minutes || settings.auto_publish_interval_minutes || 60)
          : Math.max(15, settings.auto_publish_interval_minutes || 180);
        const maxJitter = settings.scheduling_strategy_mode === 'MANUAL'
          ? 0
          : (settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30);
        const jitter = maxJitter > 0 ? (repairedConfessions.length * 7) % (maxJitter + 1) : 0;
        gapInfo = {
          min: base,
          max: base + maxJitter,
          rolledGap: base + jitter,
          reason: `Fixed cooldown: ${base}m base (+${jitter}m jitter)`,
        };
      } else {
        gapInfo = cadenceAnalyzer.calculateEffectiveGap(rec, format, category);
      }

      let dayKey = this.getDayKey(cursor, tz);
      let daySafety = 0;
      while ((postsPerDay.get(dayKey) || 0) >= maxDaily && daySafety < 30) {
        daySafety++;
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);
        dayKey = this.getDayKey(cursor, tz);
      }

      postsPerDay.set(dayKey, (postsPerDay.get(dayKey) || 0) + 1);
      const newScheduledAt = cursor.toISOString();
      const prevScheduledAt = c.scheduled_at;

      const isGrowthOptimized = !isFixed && rec.mode === 'growth_optimized';
      const gapHours = Math.floor(gapInfo.rolledGap / 60);
      const gapMins = gapInfo.rolledGap % 60;
      const gapLabel = gapHours > 0 ? (gapMins > 0 ? `${gapHours}h ${gapMins}m` : `${gapHours}h`) : `${gapMins}m`;
      const strategyLabel = isFixed ? 'Fixed cooldown' : isGrowthOptimized ? 'Growth optimized' : 'Random fallback';
      const whyThisTime = `${strategyLabel} · ${gapLabel} (Stale queue repair: ${gapInfo.reason || rec.strategy})`;

      await confessionService.updateConfession(c.id, {
        scheduled_at: newScheduledAt,
        scheduling_strategy: isFixed ? 'ADMIN_OVERRIDE' : rec.strategy,
        scheduling_gap_minutes: gapInfo.rolledGap,
        scheduling_reason: `Stale queue repair: ${gapInfo.reason}`,
        scheduling_confidence: isFixed ? 'HIGH' : rec.confidence,
        scheduling_evidence_count: isFixed ? 0 : rec.evidenceCount,
        experiment_id: isFixed ? undefined : rec.experimentId,
        why_this_time: whyThisTime,
      });

      repairedConfessions.push({
        id: c.id,
        rowNumber: c.google_sheet_row || 0,
        previousScheduledAt: prevScheduledAt,
        newScheduledAt,
        gapMinutes: gapInfo.rolledGap,
        strategy: isFixed ? 'ADMIN_OVERRIDE' : rec.strategy,
      });

      // Advance cursor for next item
      cursor = new Date(cursor.getTime() + gapInfo.rolledGap * 60 * 1000);
      cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);
    }

    // If future items would collide or land before the repaired items ended, adjust them to maintain sequence
    for (const fc of futureScheduled) {
      if (new Date(fc.scheduled_at!).getTime() < cursor.getTime()) {
        const format: MediaFormatType = fc.slides && fc.slides.length > 1 ? 'CAROUSEL' : 'IMAGE';
        const gapInfo = cadenceAnalyzer.calculateEffectiveGap(rec, format);

        let dayKey = this.getDayKey(cursor, tz);
        while ((postsPerDay.get(dayKey) || 0) >= maxDaily) {
          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
          cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);
          dayKey = this.getDayKey(cursor, tz);
        }
        postsPerDay.set(dayKey, (postsPerDay.get(dayKey) || 0) + 1);

        await confessionService.updateConfession(fc.id, {
          scheduled_at: cursor.toISOString(),
          scheduling_strategy: rec.strategy,
          scheduling_gap_minutes: gapInfo.rolledGap,
        });

        cursor = new Date(cursor.getTime() + gapInfo.rolledGap * 60 * 1000);
        cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);
      }
    }

    mockStore.addLog({
      action: 'STALE_QUEUE_REPAIRED',
      entity_type: 'queue',
      metadata: {
        repairedCount: repairedConfessions.length,
        strategy: rec.strategy,
        mode: rec.mode,
      },
    });

    return {
      repairedCount: repairedConfessions.length,
      repairedConfessions,
      strategy: rec.strategy,
      reason: `Repaired ${repairedConfessions.length} stale post(s) using ${rec.strategy} cadence strategy.`,
    };
  }

  /**
   * Get real-time queue health & diagnostic metrics
   */
  public async getQueueDiagnostics(): Promise<QueueDiagnosticsResult> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const now = new Date();
    const nowMs = now.getTime();

    let recommendation: SchedulerRecommendation | null = null;
    try {
      const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
      recommendation = await cadenceAnalyzer.getCadenceRecommendation();
    } catch {}

    const allConfessions = mockStore.getConfessions();
    const scheduled = allConfessions.filter((c) => c.status === 'SCHEDULED');
    const futureScheduled = scheduled.filter(
      (c) => c.scheduled_at && new Date(c.scheduled_at).getTime() > nowMs
    );
    const staleScheduled = scheduled.filter(
      (c) => c.scheduled_at && new Date(c.scheduled_at).getTime() <= nowMs
    );

    const todayKey = this.getDayKey(now, tz);
    const postsScheduledToday = scheduled.filter(
      (c) => c.scheduled_at && this.getDayKey(new Date(c.scheduled_at), tz) === todayKey
    ).length;

    const sortedFuture = [...futureScheduled].sort(
      (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime()
    );

    return {
      totalScheduled: scheduled.length,
      futureScheduled: futureScheduled.length,
      staleScheduled: staleScheduled.length,
      postsScheduledToday,
      maxDailyPosts: settings.max_daily_posts || 24,
      earliestScheduledAt: sortedFuture[0]?.scheduled_at || null,
      latestScheduledAt: sortedFuture[sortedFuture.length - 1]?.scheduled_at || null,
      activeHours: {
        startHour: settings.auto_publish_start_hour ?? 0,
        endHour: settings.auto_publish_end_hour ?? 24,
        timezone: tz,
      },
      recommendation,
    };
  }
}

export interface QueueDiagnosticsResult {
  totalScheduled: number;
  futureScheduled: number;
  staleScheduled: number;
  postsScheduledToday: number;
  maxDailyPosts: number;
  earliestScheduledAt: string | null;
  latestScheduledAt: string | null;
  activeHours: {
    startHour: number;
    endHour: number;
    timezone: string;
  };
  recommendation: SchedulerRecommendation | null;
}

export interface ScheduleGenerationResult {
  totalScheduled: number;
  preservedCount: number;
  newlyScheduledCount: number;
  strategy: CadenceStrategyType;
  mode: SchedulingMode;
  recommendationId: string;
  queueWindow: {
    earliest: string | null;
    latest: string | null;
  };
  items: Array<{
    id: string;
    google_sheet_row?: number;
    scheduled_at: string;
    strategy: CadenceStrategyType;
    gap_minutes: number;
    reason?: string;
  }>;
}

export const schedulingService = new SchedulingService();
