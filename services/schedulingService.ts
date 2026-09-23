import { confessionService } from './confessionService';
import { googleSheetsService } from './googleSheetsService';
import { moderationService } from './moderationService';
import { aiService } from './aiService';
import { mockStore } from '@/lib/mockStore';
import { Confession, ModerationRisk, ConfessionStatus } from '@/types';

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
    const existing = mockStore.getConfessions();

    const existingRowSet = new Set(
      existing.map((c) => c.google_sheet_row)
    );

    const newConfessions: Confession[] = [];
    const now = new Date();

    for (const row of rows) {
      const rawStatus = (row.status || '').trim().toUpperCase();
      const isAlreadyPublished = rawStatus === 'PUBLISHED' || rawStatus === 'POSTED';
      const isRejected = rawStatus === 'REJECTED';
      const isScheduled = rawStatus === 'SCHEDULED';

      // If row already exists in memory, sync any updated status from the sheet (e.g. if marked PUBLISHED or REJECTED)
      if (existingRowSet.has(row.rowNumber)) {
        if (isAlreadyPublished) {
          const existingConf = existing.find((c) => c.google_sheet_row === row.rowNumber);
          if (existingConf && existingConf.status !== 'PUBLISHED') {
            mockStore.updateConfession(existingConf.id, {
              status: 'PUBLISHED',
              published_at: row.processedAt || existingConf.published_at || new Date().toISOString(),
              instagram_media_id: row.postId || existingConf.instagram_media_id || 'sheet-imported-published',
            });
          }
        } else if (isRejected) {
          const existingConf = existing.find((c) => c.google_sheet_row === row.rowNumber);
          if (existingConf && existingConf.status !== 'REJECTED') {
            mockStore.updateConfession(existingConf.id, {
              status: 'REJECTED',
            });
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
        caption: `Confession #${row.rowNumber} 💭\n\n${cleanedText.length > 250 ? cleanedText.slice(0, 247) + '...' : cleanedText}\n\nShare your thoughts below 👇`,
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
      mockStore.addConfessions(newConfessions);
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

      // 5. Cooldown / Post Spacing Guard with Anti-Robotic Human Jitter (unless forced)
      // Meta safety: strictly enforce at least 60 minutes minimum gap between uploads
      const baseInterval = Math.max(60, settings.auto_publish_interval_minutes || 60);
      const maxJitter = settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30;

      // Persisted dynamic jitter (+0 to +30 min) so variance survives reboots and cron calls
      let jitter = settings.current_jitter_minutes;
      if (jitter === undefined || jitter === null || isNaN(jitter)) {
        jitter = maxJitter > 0 ? Math.floor(Math.random() * (maxJitter + 1)) : 0;
        mockStore.updateSettings({ current_jitter_minutes: jitter });
      }
      this.currentJitterMinutes = jitter;

      // Natural human variance: add randomized jitter (+0 to +30 min) so timestamps are never exact/robotic
      // (e.g. gaps vary naturally between ~64m, ~78m, ~85m, etc.)
      const effectiveIntervalMinutes = baseInterval + jitter;
      const minIntervalMs = effectiveIntervalMinutes * 60 * 1000;

      // In-memory guard check
      if (!force && this.lastPublishedAtMs > 0) {
        const elapsedSinceLastRun = Date.now() - this.lastPublishedAtMs;
        if (elapsedSinceLastRun < minIntervalMs) {
          const remainingMinutes = Math.ceil((minIntervalMs - elapsedSinceLastRun) / 60000);
          console.log(`[AutoPublisher] Cooldown active (${Math.floor(elapsedSinceLastRun / 60000)}m since last run, Anti-Bot Natural Jitter: +${jitter}m, dynamic gap: ${effectiveIntervalMinutes}m). Next post in ${remainingMinutes}m.`);
          return {
            ran: false,
            status: 'RATE_LIMITED',
            reason: `Post spacing cooldown active (Anti-Bot Natural Jitter: +${jitter}m applied). Last post was ${Math.floor(elapsedSinceLastRun / 60000)}m ago. Natural human gap is ${effectiveIntervalMinutes}m. Next post permitted in ${remainingMinutes}m.`,
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
          console.log(`[AutoPublisher] Cooldown active (${Math.floor(elapsedMs / 60000)}m since last post, Anti-Bot Natural Jitter: +${jitter}m, dynamic gap: ${effectiveIntervalMinutes}m). Next post in ${remainingMinutes}m.`);
          return {
            ran: false,
            status: 'RATE_LIMITED',
            reason: `Post spacing cooldown active (Anti-Bot Natural Jitter: +${jitter}m applied). Last post was ${Math.floor(elapsedMs / 60000)}m ago. Natural human gap is ${effectiveIntervalMinutes}m. Next post permitted in ${remainingMinutes}m.`,
          };
        }
      }

      // 6. Candidate Selection: Pick oldest safe confession
      const allowedRisks: ModerationRisk[] =
        settings.risk_threshold === 'HIGH'
          ? ['LOW', 'MEDIUM', 'HIGH']
          : settings.risk_threshold === 'MEDIUM'
          ? ['LOW', 'MEDIUM']
          : ['LOW'];

      // Prioritize APPROVED posts, then READY_FOR_REVIEW safe posts
      const eligibleCandidates = allConfessions
        .filter(
          (c) =>
            c.status !== 'PUBLISHED' &&
            c.status !== 'REJECTED' &&
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

      const candidate = eligibleCandidates[0];

      if (!candidate) {
        console.log('[AutoPublisher] No eligible safe confessions found to auto-publish.');
        return {
          ran: false,
          status: 'NO_CANDIDATES',
          reason: 'No eligible safe confessions in queue. (High-risk or already published confessions are skipped).',
        };
      }

      console.log(`[AutoPublisher] Selected confession #${candidate.google_sheet_row} (ID: ${candidate.id}) for auto-publishing.`);

      // Lock candidate immediately to prevent concurrent re-selection
      await confessionService.updateConfession(candidate.id, { status: 'PUBLISHING' });

      // 6b. Groq AI Duplicate Detection against all already published posts
      const previousPosts = allConfessions
        .filter((c) => c.status === 'PUBLISHED' && c.id !== candidate.id)
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
      // Rotate natural human jitter for next post (+0 to +30 min dynamic variance)
      // Completely eliminates robotic fixed timestamps (e.g. posts won't fire at exact clockwork intervals like 60m 00s; instead, gaps vary between ~64m, ~78m, ~85m, etc.)
      const nextMaxJitter = settings.anti_bot_jitter_minutes !== undefined ? settings.anti_bot_jitter_minutes : 30;
      const nextJitter = nextMaxJitter > 0 ? Math.floor(Math.random() * (nextMaxJitter + 1)) : 0;
      this.currentJitterMinutes = nextJitter;
      mockStore.updateSettings({ current_jitter_minutes: nextJitter });

      mockStore.addLog({
        action: 'AUTO_PUBLISHED',
        entity_type: 'confession',
        entity_id: candidate.id,
        metadata: {
          row: candidate.google_sheet_row,
          permalink: publishedConfession.instagram_permalink,
          mediaId: publishedConfession.instagram_media_id,
          jitterAppliedMinutes: jitter,
          effectiveIntervalMinutes: effectiveIntervalMinutes,
          nextJitterMinutes: nextJitter,
          nextIntervalMinutes: baseInterval + nextJitter,
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
}

export const schedulingService = new SchedulingService();
