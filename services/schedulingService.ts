import { confessionService } from './confessionService';
import { googleSheetsService } from './googleSheetsService';
import { moderationService } from './moderationService';
import { mockStore } from '@/lib/mockStore';
import { Confession, ModerationRisk } from '@/types';

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

  /**
   * Run scheduled posts publisher check (called by /api/cron/publish-scheduled)
   */
  public async processDuePosts(): Promise<{ published: string[]; errors: { id: string; error: string }[] }> {
    if (this.isProcessingCron) {
      console.log('[SchedulingService] Cron run already in progress, skipping concurrent trigger');
      return { published: [], errors: [] };
    }

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
      existing.map((c) => `${c.google_sheet_id}_${c.google_sheet_row}`)
    );

    const newConfessions: Confession[] = [];
    const now = new Date();

    for (const row of rows) {
      const key = `${config.spreadsheet_id}_${row.rowNumber}`;
      if (existingRowSet.has(key)) {
        continue;
      }

      if (!row.confession || row.confession.trim().length === 0) {
        continue;
      }

      const newId = `confession-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // In-memory safety analysis & PII masking
      const moderationResult = moderationService.analyzeContent(row.confession);
      const cleanedText = moderationService.maskSensitiveInformation(
        row.confession,
        moderationResult.piiDetected
      );

      const isAnon = row.isAnonymous !== undefined 
        ? row.isAnonymous 
        : ((row.name || '').toLowerCase() === 'anonymous' || !row.name);

      const displayName = isAnon ? 'Anonymous' : (row.name || 'Anonymous');

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
        status: 'READY_FOR_REVIEW',
        moderation_status: moderationResult.risk,
        moderation_reason: moderationResult.reasons.length > 0 
          ? moderationResult.reasons.join('; ') 
          : 'Passed safety validation.',
        ai_processed: false,
        template_id: '11111111-1111-1111-1111-111111111111',
        generated_image_url: null,
        generated_image_path: null,
        caption: `Confession #${row.rowNumber} 💭\n\n${cleanedText.length > 250 ? cleanedText.slice(0, 247) + '...' : cleanedText}\n\nShare your thoughts below 👇`,
        hashtags: ['#confession', '#campuslife', '#studentconfessions'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date(now.getTime() - (rows.length - row.rowNumber) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      };

      newConfessions.push(newConfession);
      existingRowSet.add(key);
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
      const maxDaily = settings.max_daily_posts || 10;

      // 3. Daily volume guard
      if (stats.publishedToday >= maxDaily && !force) {
        console.warn(`[AutoPublisher] Daily post limit reached (${stats.publishedToday}/${maxDaily}). Stopping for today.`);
        return {
          ran: false,
          status: 'DAILY_LIMIT_REACHED',
          reason: `Daily post cap reached (${stats.publishedToday}/${maxDaily}).`,
        };
      }

      // 4. Active hours window guard (unless forced manually via button)
      if (!force) {
        try {
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: settings.timezone || 'Asia/Kolkata',
            hour: 'numeric',
            hour12: false,
          });
          const currentHour = parseInt(formatter.format(new Date()), 10);
          const startHour = settings.auto_publish_start_hour ?? 9;
          const endHour = settings.auto_publish_end_hour ?? 23;

          if (currentHour < startHour || currentHour >= endHour) {
            console.log(`[AutoPublisher] Outside active hours (${currentHour}:00, window is ${startHour}:00 - ${endHour}:00). Skipping.`);
            return {
              ran: false,
              status: 'OUTSIDE_HOURS',
              reason: `Outside active hours (${currentHour}:00 in ${settings.timezone || 'Asia/Kolkata'}). Active window is ${startHour}:00 - ${endHour}:00.`,
            };
          }
        } catch {
          // If timezone formatting fails, proceed safely
        }
      }

      // 5. Cooldown / Post Spacing Guard (unless forced)
      const allConfessions = mockStore.getConfessions();
      const publishedPosts = allConfessions
        .filter((c) => c.status === 'PUBLISHED' && c.published_at)
        .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime());

      const lastPublished = publishedPosts[0];
      const intervalMinutes = settings.auto_publish_interval_minutes ?? 120;
      const minIntervalMs = intervalMinutes * 60 * 1000;

      if (!force && lastPublished && lastPublished.published_at) {
        const elapsedMs = Date.now() - new Date(lastPublished.published_at).getTime();
        if (elapsedMs < minIntervalMs) {
          const remainingMinutes = Math.ceil((minIntervalMs - elapsedMs) / 60000);
          console.log(`[AutoPublisher] Cooldown active (${Math.floor(elapsedMs / 60000)}m since last post, interval is ${intervalMinutes}m). Next post in ${remainingMinutes}m.`);
          return {
            ran: false,
            status: 'RATE_LIMITED',
            reason: `Post spacing cooldown active. Last post was ${Math.floor(elapsedMs / 60000)}m ago. Next post permitted in ${remainingMinutes}m.`,
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
            (c.status === 'APPROVED' || c.status === 'READY_FOR_REVIEW') &&
            allowedRisks.includes(c.moderation_status) &&
            !c.instagram_media_id
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

      mockStore.addLog({
        action: 'AUTO_PUBLISHED',
        entity_type: 'confession',
        entity_id: candidate.id,
        metadata: {
          row: candidate.google_sheet_row,
          permalink: publishedConfession.instagram_permalink,
          mediaId: publishedConfession.instagram_media_id,
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
