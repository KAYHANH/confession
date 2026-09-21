import { confessionService } from './confessionService';
import { googleSheetsService } from './googleSheetsService';
import { moderationService } from './moderationService';
import { mockStore } from '@/lib/mockStore';
import { Confession } from '@/types';

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

    return { imported: newConfessions.length, processed: newConfessions.length };
  }
}

export const schedulingService = new SchedulingService();
