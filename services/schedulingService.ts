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

  /**
   * Run scheduled posts publisher check (called by /api/cron/publish-scheduled)
   */
  public async processDuePosts(): Promise<{ published: string[]; errors: { id: string; error: string }[] }> {
    if (this.isProcessingCron) {
      console.log('[SchedulingService] Cron run already in progress, skipping concurrent trigger');
      return { published: [], errors: [] };
    }

    const settings = mockStore.getSettings();

    // Respect safe human daytime hours (9:00 AM to 10:00 PM) for scheduled posts
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone || 'Asia/Kolkata',
        hour: 'numeric',
        hour12: false,
      });
      const currentHour = parseInt(formatter.format(new Date()), 10);
      const startHour = settings.auto_publish_start_hour ?? 9;
      const endHour = settings.auto_publish_end_hour ?? 22;

      if (currentHour < startHour || currentHour >= endHour) {
        console.log(`[SchedulingService] Outside active human hours (${currentHour}:00, safe daytime window is ${startHour}:00 - ${endHour}:00). Resting account overnight.`);
        return { published: [], errors: [] };
      }
    } catch {}

    this.isProcessingCron = true;
    const published: string[] = [];
    const errors: { id: string; error: string }[] = [];

    try {
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

        if (isAlreadyPublished) {
          if (existingConf && existingConf.status !== 'PUBLISHED') {
            const updatePayload = {
              status: 'PUBLISHED' as ConfessionStatus,
              published_at: row.processedAt || existingConf.published_at || new Date().toISOString(),
              instagram_media_id: row.postId || existingConf.instagram_media_id || 'sheet-imported-published',
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

      const isAnon = row.isAnonymous !== undefined 
        ? row.isAnonymous 
        : ((row.name || '').toLowerCase() === 'anonymous' || !row.name);

      const displayName = isAnon ? 'Anonymous' : (row.name || 'Anonymous');

      const initialStatus: ConfessionStatus = isAlreadyPublished
        ? 'PUBLISHED'
        : isRejected
        ? 'REJECTED'
        : isScheduled
        ? 'SCHEDULED'
        : 'READY_FOR_REVIEW';

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
        created_at: new Date(now.getTime() - (rows.length - row.rowNumber) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      };

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

    // 1. Check if any explicitly SCHEDULED posts are due right now
    try {
      const scheduledRes = await this.processDuePosts();
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

    const settings = mockStore.getSettings();
    const isAutoPublishActive = settings.auto_publish === true || settings.publishing_mode === 'AUTO_PUBLISH';

    // 2. If auto_publish is not enabled, check if AUTO_APPROVAL mode is active to pre-approve low-risk posts
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

    this.isProcessingCron = true;

    let candidate: Confession | undefined;

    try {
      const stats = await confessionService.getDashboardStats();
      const maxDaily = settings.max_daily_posts || 8;

      // 3. Daily volume guard (max 8 daily posts default)
      if (stats.publishedToday >= maxDaily && !force) {
        console.warn(`[AutoPublisher] Daily post limit reached (${stats.publishedToday}/${maxDaily}). Resting account until tomorrow.`);
        return {
          ran: false,
          status: 'DAILY_LIMIT_REACHED',
          reason: `Daily post cap reached (${stats.publishedToday}/${maxDaily}). Account is resting until tomorrow to avoid Meta spam detection.`,
        };
      }

      // 4. Active hours window guard (unless forced manually via button)
      // Mimic human daytime schedule: 9:00 AM (09:00) to 10:00 PM (22:00)
      // Avoids posting between 10:00 PM and 9:00 AM (resting account overnight)
      if (!force) {
        try {
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: settings.timezone || 'Asia/Kolkata',
            hour: 'numeric',
            hour12: false,
          });
          const currentHour = parseInt(formatter.format(new Date()), 10);
          const startHour = settings.auto_publish_start_hour ?? 9;
          const endHour = settings.auto_publish_end_hour ?? 22;

          if (currentHour < startHour || currentHour >= endHour) {
            console.log(`[AutoPublisher] Outside active human hours (${currentHour}:00, safe daytime window is ${startHour}:00 - ${endHour}:00). Resting account.`);
            return {
              ran: false,
              status: 'OUTSIDE_HOURS',
              reason: `Outside active human hours (${currentHour}:00 in ${settings.timezone || 'Asia/Kolkata'}). Safe daytime window is ${startHour}:00 - ${endHour}:00. Overnight account rest active.`,
            };
          }
        } catch {
          // If timezone formatting fails, proceed safely
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
      } else if (cadenceRec && cadenceRec.mode === 'growth_optimized') {
        // MODE 2: GROWTH OPTIMIZED — Uses Growth Intelligence recommended cadence range
        const recMin = cadenceRec.recommendedGapRangeMinutes.min;
        const recMax = cadenceRec.recommendedGapRangeMinutes.max;
        let rolledGap = settings.current_random_gap_minutes;
        if (!rolledGap || rolledGap < recMin || rolledGap > recMax) {
          rolledGap = Math.floor(Math.random() * (recMax - recMin + 1)) + recMin;
          mockStore.updateSettings({ current_random_gap_minutes: rolledGap });
        }
        effectiveIntervalMinutes = rolledGap;
        console.log(`[AutoPublisher] Growth-Optimized cadence active (${effectiveIntervalMinutes}m gap, Strategy: ${cadenceRec.strategy}, Confidence: ${cadenceRec.confidence}, Evidence: N=${cadenceRec.evidenceCount}).`);
      } else if (cadenceRec && cadenceRec.mode === 'manual') {
        // MODE 4: MANUAL OVERRIDE
        effectiveIntervalMinutes = cadenceRec.recommendedGapRangeMinutes.min;
      } else {
        // MODE 1: BASELINE EXPLORATION — Safe baseline range when data is insufficient or fallback
        const minGap = Math.max(25, settings.min_gap_minutes ?? 30);
        const maxGap = Math.max(minGap + 5, settings.max_gap_minutes ?? 75);
        let rolledGap = settings.current_random_gap_minutes;
        if (!rolledGap || rolledGap < minGap || rolledGap > maxGap) {
          rolledGap = Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
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

      // 6. Auto-heal any confessions stuck in PUBLISHING (>3m) or failed due to double-https image bug
      const nowMs = Date.now();
      for (const c of allConfessions) {
        if (c.status === 'PUBLISHING') {
          const updatedMs = new Date(c.updated_at || c.created_at || 0).getTime();
          if (nowMs - updatedMs > 3 * 60 * 1000) {
            console.log(`[AutoPublisher] Auto-healing confession #${c.google_sheet_row} stuck in PUBLISHING back to APPROVED.`);
            await confessionService.updateConfession(c.id, {
              status: 'APPROVED',
              error_message: null,
            });
          }
        } else if (
          (c.status === 'FAILED' || c.status === 'FAILED_REQUIRES_ACTION') &&
          c.error_message &&
          (c.error_message.includes('https://https://') || c.error_message.includes('cannot download the card image'))
        ) {
          console.log(`[AutoPublisher] Auto-healing confession #${c.google_sheet_row} that failed due to URL glitch back to APPROVED.`);
          await confessionService.updateConfession(c.id, {
            status: 'APPROVED',
            error_message: null,
            retry_count: 0,
            generated_image_url: null,
          });
        }
      }

      // Re-fetch fresh confessions after healing
      const freshConfessions = mockStore.getConfessions();

      const allowedRisks: ModerationRisk[] =
        settings.risk_threshold === 'HIGH'
          ? ['LOW', 'MEDIUM', 'HIGH']
          : settings.risk_threshold === 'MEDIUM'
          ? ['LOW', 'MEDIUM']
          : ['LOW'];

      // Prioritize APPROVED posts, then READY_FOR_REVIEW safe posts
      const eligibleCandidates = freshConfessions
        .filter(
          (c) =>
            c.status !== 'PUBLISHED' &&
            c.status !== 'REJECTED' &&
            c.status !== 'DELETED' &&
            c.status !== 'PUBLISHING' &&
            (c.status === 'APPROVED' || c.status === 'READY_FOR_REVIEW') &&
            allowedRisks.includes(c.moderation_status) &&
            !c.instagram_media_id &&
            !c.published_at
        )
        .sort((a, b) => {
          // APPROVED first, then lowest row number
          if (a.status === 'APPROVED' && b.status !== 'APPROVED') return -1;
          if (b.status === 'APPROVED' && a.status !== 'APPROVED') return 1;
          return (a.google_sheet_row || 0) - (b.google_sheet_row || 0);
        });

      candidate = eligibleCandidates[0];

      if (!candidate) {
        console.log('[AutoPublisher] No eligible safe confessions found to auto-publish.');
        return {
          ran: false,
          status: 'NO_CANDIDATES',
          reason: 'No eligible safe confessions in queue. (High-risk or already published confessions are skipped).',
        };
      }

      const selectedCandidate = candidate;

      console.log(`[AutoPublisher] Selected confession #${selectedCandidate.google_sheet_row} (ID: ${selectedCandidate.id}) for auto-publishing.`);

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
      if (cadenceRec && cadenceRec.mode === 'growth_optimized') {
        const recMin = cadenceRec.recommendedGapRangeMinutes.min;
        const recMax = cadenceRec.recommendedGapRangeMinutes.max;
        nextGap = Math.floor(Math.random() * (recMax - recMin + 1)) + recMin;
        mockStore.updateSettings({ current_random_gap_minutes: nextGap });
        console.log(`[AutoPublisher] Rolled next Growth-Optimized gap: ${nextGap}m (range: ${recMin}m–${recMax}m, Strategy: ${cadenceRec.strategy}).`);
      } else if (isRandomGap) {
        const minGap = Math.max(25, settings.min_gap_minutes ?? 30);
        const maxGap = Math.max(minGap + 5, settings.max_gap_minutes ?? 75);
        nextGap = Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
        mockStore.updateSettings({ current_random_gap_minutes: nextGap });
        console.log(`[AutoPublisher] Rolled next organic random gap: ${nextGap}m (range: ${minGap}m–${maxGap}m).`);
      } else {
        const nextMaxJitter = settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30;
        const nextJitter = nextMaxJitter > 0 ? Math.floor(Math.random() * (nextMaxJitter + 1)) : 0;
        this.currentJitterMinutes = nextJitter;
        nextGap = baseInterval + nextJitter;
        mockStore.updateSettings({ current_jitter_minutes: nextJitter });
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
    const toApprove = confessions.filter(
      (c) => c.status === 'READY_FOR_REVIEW' && c.moderation_status === 'LOW'
    );
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
    const startHour = settings.auto_publish_start_hour ?? 9;
    const endHour = settings.auto_publish_end_hour ?? 22;

    let candidate = new Date(targetDate.getTime());
    const nowMs = Date.now();

    // Ensure candidate is at least 1 minute in the future
    if (candidate.getTime() <= nowMs) {
      candidate = new Date(nowMs + 60 * 1000);
    }

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
   * - Preserves valid future timestamps when preserveExistingFuture=true (no flapping on page reload)
   * - Applies sample-size-gated cadence intervals & format/category awareness
   * - Enforces daily post limits and active human daytime hours
   */
  public async generateFutureSchedule(options?: {
    forceRecalculate?: boolean;
    preserveExistingFuture?: boolean;
  }): Promise<ScheduleGenerationResult> {
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const maxDaily = settings.max_daily_posts || 8;
    const forceRecalculate = options?.forceRecalculate ?? false;
    const preserveExisting = options?.preserveExistingFuture ?? true;

    const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
    const rec = await cadenceAnalyzer.getCadenceRecommendation();

    const allConfessions = mockStore.getConfessions();
    const now = new Date();
    const nowMs = now.getTime();

    // Eligible candidates for scheduled queue
    const eligible = allConfessions.filter(
      (c) =>
        c.status !== 'PUBLISHED' &&
        c.status !== 'REJECTED' &&
        c.status !== 'DELETED' &&
        c.status !== 'PUBLISHING' &&
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

    // Sort strictly in FIFO order by Google Sheet row number
    itemsToSchedule.sort((a, b) => (a.google_sheet_row || 0) - (b.google_sheet_row || 0));

    // Track daily post volume across days to enforce max_daily_posts
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

    const scheduledResults: Array<{
      id: string;
      google_sheet_row?: number;
      scheduled_at: string;
      strategy: CadenceStrategyType;
      gap_minutes: number;
      reason?: string;
    }> = [];

    let lastRolledGap = 0;
    for (const c of itemsToSchedule) {
      const format: MediaFormatType = c.slides && c.slides.length > 1 ? 'CAROUSEL' : 'IMAGE';
      const category = (c as any).content_category || undefined;
      const gapInfo = cadenceAnalyzer.calculateEffectiveGap(rec, format, category);

      // Prevent adjacent identical gaps (e.g. 70m, 70m) to guarantee organic human variation
      if (gapInfo.rolledGap === lastRolledGap && gapInfo.max > gapInfo.min) {
        gapInfo.rolledGap = Math.floor(Math.random() * (gapInfo.max - gapInfo.min + 1)) + gapInfo.min;
        if (gapInfo.rolledGap === lastRolledGap) {
          gapInfo.rolledGap = gapInfo.rolledGap > gapInfo.min ? gapInfo.rolledGap - 5 : gapInfo.rolledGap + 5;
        }
      }
      lastRolledGap = gapInfo.rolledGap;

      // Advance cursor by the evidence-backed interval
      cursor = new Date(cursor.getTime() + gapInfo.rolledGap * 60 * 1000);
      cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);

      // Enforce daily cap (pushing excess posts to next day's active hours)
      let dayKey = this.getDayKey(cursor, tz);
      let daySafety = 0;
      while ((postsPerDay.get(dayKey) || 0) >= maxDaily && daySafety < 30) {
        daySafety++;
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        cursor = this.alignToActiveHours(cursor, settings, rec.preferredWindows);
        dayKey = this.getDayKey(cursor, tz);
      }

      postsPerDay.set(dayKey, (postsPerDay.get(dayKey) || 0) + 1);

      const scheduledAtIso = cursor.toISOString();
      await confessionService.updateConfession(c.id, {
        status: 'SCHEDULED',
        scheduled_at: scheduledAtIso,
        scheduling_strategy: rec.strategy,
        scheduling_gap_minutes: gapInfo.rolledGap,
        scheduling_reason: gapInfo.reason,
        scheduling_confidence: rec.confidence,
        scheduling_evidence_count: rec.evidenceCount,
        experiment_id: rec.experimentId,
      });

      scheduledResults.push({
        id: c.id,
        google_sheet_row: c.google_sheet_row,
        scheduled_at: scheduledAtIso,
        strategy: rec.strategy,
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
   * Stale Queue Repair:
   * Reschedules past-due scheduled items (scheduled_at <= now) using current Growth Intelligence strategy
   * starting from now. Strictly preserves FIFO ordering and avoids arbitrary shifts.
   */
  public async repairStaleQueue(): Promise<StaleQueueRepairResult> {
    const now = new Date();
    const nowMs = now.getTime();
    const settings = mockStore.getSettings();
    const tz = settings.timezone || 'Asia/Kolkata';
    const maxDaily = settings.max_daily_posts || 8;

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
      const gapInfo = cadenceAnalyzer.calculateEffectiveGap(rec, format, category);

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

      await confessionService.updateConfession(c.id, {
        scheduled_at: newScheduledAt,
        scheduling_strategy: rec.strategy,
        scheduling_gap_minutes: gapInfo.rolledGap,
        scheduling_reason: `Stale queue repair: ${gapInfo.reason}`,
        scheduling_confidence: rec.confidence,
        scheduling_evidence_count: rec.evidenceCount,
        experiment_id: rec.experimentId,
      });

      repairedConfessions.push({
        id: c.id,
        rowNumber: c.google_sheet_row || 0,
        previousScheduledAt: prevScheduledAt,
        newScheduledAt,
        gapMinutes: gapInfo.rolledGap,
        strategy: rec.strategy,
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
      maxDailyPosts: settings.max_daily_posts || 8,
      earliestScheduledAt: sortedFuture[0]?.scheduled_at || null,
      latestScheduledAt: sortedFuture[sortedFuture.length - 1]?.scheduled_at || null,
      activeHours: {
        startHour: settings.auto_publish_start_hour ?? 9,
        endHour: settings.auto_publish_end_hour ?? 22,
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
