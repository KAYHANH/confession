import { Confession, ConfessionStatus, DashboardStats, SystemSettings } from '@/types';
import { mockStore } from '@/lib/mockStore';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { aiService } from './aiService';
import { imageService } from './imageService';
import { instagramService } from './instagramService';
import { googleSheetsService } from './googleSheetsService';
import { moderationService } from './moderationService';
import { publicationReconciliationService } from './reconciliationService';
import {
  paginateConfession,
  buildInstagramCaption,
  canFitOnSingleCard,
  createHookText,
  validatePublicationPayload,
  verifyContentPreservation,
} from '@/lib/paginationEngine';
import { confessionQualityService } from './quality/confessionQualityService';
import { validatePublishEligibility } from './quality/publishEligibilityService';
import {
  generateContentHash,
  normalizeConfessionText,
  createPublishIdempotencyKey,
} from '@/lib/contentHash';

// Valid status transitions map
export const ALLOWED_TRANSITIONS: Record<ConfessionStatus, ConfessionStatus[]> = {
  NEW: ['IMPORTED', 'DELETED'],
  IMPORTED: ['PROCESSING', 'DELETED'],
  PROCESSING: ['READY_FOR_REVIEW', 'REJECTED', 'DELETED'],
  READY_FOR_REVIEW: ['APPROVED', 'SCHEDULED', 'REJECTED', 'PUBLISHING', 'DELETED'],
  APPROVED: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'CANCELLED', 'DELETED', 'DUPLICATE_ALREADY_PUBLISHED', 'FAILED_REQUIRES_ACTION'],
  REJECTED: ['READY_FOR_REVIEW', 'APPROVED', 'DELETED'],
  SCHEDULED: ['PUBLISHING', 'PUBLISHED', 'APPROVED', 'REJECTED', 'CANCELLED', 'DELETED', 'DUPLICATE_ALREADY_PUBLISHED', 'FAILED_REQUIRES_ACTION'],
  PUBLISHING: ['PUBLISHED', 'FAILED', 'FAILED_CONFIRMED', 'FAILED_REQUIRES_ACTION', 'UNKNOWN', 'UNKNOWN_NEEDS_REVIEW', 'DUPLICATE_ALREADY_PUBLISHED', 'DELETED'],
  PUBLISHED: [],
  FAILED: ['APPROVED', 'READY_FOR_REVIEW', 'PUBLISHING', 'FAILED_CONFIRMED', 'FAILED_REQUIRES_ACTION', 'UNKNOWN_NEEDS_REVIEW', 'DUPLICATE_ALREADY_PUBLISHED', 'REJECTED', 'DELETED'],
  FAILED_CONFIRMED: ['READY_FOR_REVIEW', 'APPROVED', 'PUBLISHING', 'FAILED_REQUIRES_ACTION', 'REJECTED', 'DELETED'],
  FAILED_REQUIRES_ACTION: ['APPROVED', 'READY_FOR_REVIEW', 'PUBLISHING', 'REJECTED', 'DELETED'],
  UNKNOWN: ['PUBLISHED', 'UNKNOWN_NEEDS_REVIEW', 'FAILED_CONFIRMED', 'DUPLICATE_ALREADY_PUBLISHED', 'REJECTED', 'DELETED'],
  UNKNOWN_NEEDS_REVIEW: ['PUBLISHED', 'FAILED_CONFIRMED', 'DUPLICATE_ALREADY_PUBLISHED', 'APPROVED', 'REJECTED', 'DELETED'],
  DUPLICATE_ALREADY_PUBLISHED: ['DELETED'],
  CANCELLED: ['READY_FOR_REVIEW', 'APPROVED', 'DELETED'],
  DELETED: ['APPROVED', 'READY_FOR_REVIEW'],
};

export class ConfessionService {
  // In-memory mutex locks to ensure zero concurrent publishing race conditions
  private publishingLocks = new Set<string>();

  private useSupabase(): boolean {
    return (
      process.env.DISABLE_SUPABASE !== 'true' &&
      process.env.USE_SUPABASE !== 'false' &&
      process.env.MOCK_EXTERNAL_APIS !== 'true' &&
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );
  }

  /**
   * Decode a raw Supabase row, remapping the soft-delete workaround back to
   * logical status='DELETED'. Because Supabase's valid_status CHECK constraint
   * does not include 'DELETED', soft-deletes are stored as:
   *   status = 'REJECTED'
   *   error_message = '__DELETED__:<ISO_TIMESTAMP>'
   * This helper reverses that encoding so the rest of the app sees status='DELETED'
   * and deleted_at=<timestamp> exactly as if the column existed.
   */
  private decodeSupabaseRow(row: any): any {
    if (row && typeof row.error_message === 'string' && row.error_message.startsWith('__DELETED__:')) {
      const isoTimestamp = row.error_message.slice('__DELETED__:'.length);
      return {
        ...row,
        status: 'DELETED',
        deleted_at: isoTimestamp,
        error_message: null, // hide the marker from the UI
      };
    }
    return row;
  }

  /**
   * Validate if a status transition is permitted
   */
  public isValidTransition(current: ConfessionStatus, next: ConfessionStatus): boolean {
    if (current === next) return true;
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  /**
   * Quarantines any confessions stuck in PUBLISHING (>3 minutes) to UNKNOWN_NEEDS_REVIEW.
   * NEVER reset stuck PUBLISHING back to APPROVED, because it may already be live on Instagram!
   */
  public async autoHealStuckConfessions(): Promise<number> {
    let healed = 0;
    const nowMs = Date.now();
    for (const c of mockStore.getConfessions()) {
      if (c.status === 'PUBLISHING') {
        const updatedMs = new Date(c.updated_at || c.created_at || 0).getTime();
        if (nowMs - updatedMs > 3 * 60 * 1000) {
          console.warn(`[ConfessionService] Confession #${c.google_sheet_row || c.id} was stuck in PUBLISHING >3m. Transitioning to UNKNOWN_NEEDS_REVIEW for reconciliation.`);
          mockStore.updateConfession(c.id, {
            status: 'UNKNOWN_NEEDS_REVIEW',
            reconciliation_status: 'NEEDS_REVIEW',
            reconciliation_notes: 'Stuck in PUBLISHING state for >3 minutes. Quarantined to prevent duplicate publishing.',
            error_message: 'Publish timed out or crashed in flight. Reconcile with Instagram before retrying.',
          });
          healed++;
        }
      }
    }
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        const threeMinsAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('confessions')
          .update({
            status: 'UNKNOWN_NEEDS_REVIEW',
            error_message: 'Publish timed out or crashed in flight. Reconcile with Instagram before retrying.',
            updated_at: new Date().toISOString()
          })
          .eq('status', 'PUBLISHING')
          .lt('updated_at', threeMinsAgo)
          .select('id');
        if (data) healed += data.length;
      } catch {}
    }
    return healed;
  }

  /**
   * Get all confessions with filtering, search, and pagination
   */
  public async getConfessions(options: {
    tab?: 'queue' | 'scheduled' | 'published' | 'unknown' | 'duplicates' | 'low_value' | 'deleted' | 'failed';
    status?: ConfessionStatus;
    moderationStatus?: string;
    qualityStatus?: string;
    search?: string;
    templateId?: string;
    sortBy?: 'newest' | 'oldest' | 'scheduled' | 'recently_published';
    page?: number;
    limit?: number;
  } = {}): Promise<{ confessions: Confession[]; total: number; page: number; totalPages: number }> {
    const { tab, status, moderationStatus, qualityStatus, search, templateId, sortBy = 'newest', page = 1, limit = 50 } = options;

    // Real Supabase query if configured
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        let query = supabase.from('confessions').select('*', { count: 'exact' });

        // Handle soft-delete workaround: DELETED rows are stored as REJECTED + __DELETED__ marker
        if (status === 'DELETED' || tab === 'deleted') {
          query = query.eq('status', 'REJECTED').like('error_message', '__DELETED__%');
        } else if (tab === 'scheduled' || status === 'SCHEDULED') {
          query = query.eq('status', 'SCHEDULED');
        } else if (tab === 'published' || status === 'PUBLISHED') {
          query = query.eq('status', 'PUBLISHED');
        } else if (status) {
          if (status === 'REJECTED') {
            query = query.eq('status', 'REJECTED').not('error_message', 'like', '__DELETED__%');
          } else {
            query = query.eq('status', status);
          }
        }
        if (moderationStatus) query = query.eq('moderation_status', moderationStatus);
        if (templateId) query = query.eq('template_id', templateId);
        if (search) query = query.ilike('cleaned_text', `%${search}%`);

        if (sortBy === 'oldest') query = query.order('created_at', { ascending: true });
        else if (sortBy === 'scheduled') query = query.order('scheduled_at', { ascending: false });
        else if (sortBy === 'recently_published') query = query.order('published_at', { ascending: false });
        else query = query.order('created_at', { ascending: false });

        const startIndex = (page - 1) * limit;
        query = query.range(startIndex, startIndex + limit - 1);

        const { data, error, count } = await query;
        if (!error && data && data.length > 0) {
          return {
            confessions: (data || []).map((r: any) => this.decodeSupabaseRow(r)) as Confession[],
            total: count || 0,
            page,
            totalPages: Math.ceil((count || 0) / limit) || 1,
          };
        }
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase getConfessions query failed, falling back to mockStore:', sbErr);
      }
    }

    // Default & Fallback: Read from mockStore
    let list = mockStore.getConfessions();

    if (tab === 'queue') {
      list = list.filter(
        (c) =>
          !['PUBLISHED', 'SCHEDULED', 'REJECTED', 'DELETED', 'FAILED', 'FAILED_CONFIRMED', 'FAILED_REQUIRES_ACTION', 'UNKNOWN', 'UNKNOWN_NEEDS_REVIEW', 'DUPLICATE_ALREADY_PUBLISHED', 'CANCELLED'].includes(c.status) &&
          c.quality_status !== 'LOW_VALUE'
      );
    } else if (tab === 'scheduled') {
      list = list.filter((c) => c.status === 'SCHEDULED');
    } else if (tab === 'published') {
      list = list.filter((c) => c.status === 'PUBLISHED');
    } else if (tab === 'unknown') {
      list = list.filter((c) => c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW');
    } else if (tab === 'duplicates') {
      list = list.filter((c) => c.status === 'DUPLICATE_ALREADY_PUBLISHED');
    } else if (tab === 'low_value') {
      list = list.filter(
        (c) =>
          c.status !== 'DELETED' &&
          (c.quality_status === 'LOW_VALUE' ||
            c.quality_decision === 'REJECT' ||
            (c.status === 'REJECTED' && c.quality_category === 'LOW_INFORMATION'))
      );
    } else if (tab === 'deleted') {
      list = list.filter((c) => c.status === 'DELETED');
    } else if (tab === 'failed') {
      list = list.filter(
        (c) =>
          (c.status === 'FAILED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED_REQUIRES_ACTION') &&
          !c.instagram_media_id &&
          !c.published_at
      );
    }

    if (status) {
      list = list.filter((c) => c.status === status);
    }
    if (moderationStatus) {
      list = list.filter((c) => c.moderation_status === moderationStatus);
    }
    if (qualityStatus) {
      list = list.filter((c) => c.quality_status === qualityStatus);
    }
    if (templateId) {
      list = list.filter((c) => c.template_id === templateId);
    }
    if (search && search.trim().length > 0) {
      const query = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.original_text.toLowerCase().includes(query) ||
          c.cleaned_text.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query) ||
          c.display_name.toLowerCase().includes(query)
      );
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'oldest') {
        return (a.google_sheet_row || 0) - (b.google_sheet_row || 0);
      }
      if (sortBy === 'newest') {
        return (b.google_sheet_row || 0) - (a.google_sheet_row || 0);
      }
      if (sortBy === 'scheduled') {
        return (a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0) - (b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0);
      }
      if (sortBy === 'recently_published') {
        return (b.published_at ? new Date(b.published_at).getTime() : 0) - (a.published_at ? new Date(a.published_at).getTime() : 0);
      }
      // Default: ascending row order (sheet row 2, 3, 4... = publish order)
      return (a.google_sheet_row || 0) - (b.google_sheet_row || 0);
    });

    const total = list.length;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    return {
      confessions: paginated,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get single confession by ID
   */
  public async getConfessionById(id: string): Promise<Confession | null> {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;

    // 1. Check mockStore first (fast, reliable)
    const localConf = mockStore.getConfessionById(cleanId) || mockStore.getConfessions().find((c) => c.id === cleanId);
    if (localConf) return localConf;

    // 2. Try Supabase if configured
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase.from('confessions').select('*').eq('id', cleanId).single();
        if (!error && data) {
          return this.decodeSupabaseRow(data) as Confession;
        }
      } catch (err) {
        console.warn('[ConfessionService] Supabase getConfessionById error:', err);
      }
    }

    // 3. Fallback: match by row number
    const rowNum = parseInt(cleanId, 10);
    if (!isNaN(rowNum) && rowNum > 0) {
      const byRow = mockStore.getConfessions().find((c) => c.google_sheet_row === rowNum);
      if (byRow) return byRow;
    }

    return null;
  }

  /**
   * Update confession fields
   */
  public async updateConfession(id: string, updates: Partial<Confession>): Promise<Confession> {
    const cleanId = String(id || '').trim();
    const existing = await this.getConfessionById(cleanId);
    if (!existing) throw new Error(`Confession not found: ${id}`);

    // Re-evaluate quality gate on material text changes (Step 17)
    if (
      (updates.cleaned_text && updates.cleaned_text !== existing.cleaned_text) ||
      (updates.original_text && updates.original_text !== existing.original_text)
    ) {
      try {
        const newText = updates.cleaned_text || updates.original_text || existing.cleaned_text || existing.original_text;
        const qRes = await confessionQualityService.evaluateConfession(newText, {
          confessionId: existing.id,
        });
        updates.quality_status = qRes.qualityStatus;
        updates.quality_score = qRes.qualityScore;
        updates.quality_decision = qRes.decision;
        updates.quality_intent = qRes.intent;
        updates.quality_reason = qRes.reason;
        updates.quality_category = qRes.category;
        updates.quality_confidence = qRes.confidence;
        updates.quality_model_version = qRes.modelVersion;
        updates.quality_prompt_version = qRes.promptVersion;
        updates.quality_rules_version = qRes.rulesVersion;
        updates.quality_analyzed_at = qRes.analyzedAt;
        updates.quality_override = null; // Invalidate previous override on edit
      } catch (qErr) {
        console.warn('[ConfessionService] Failed to re-evaluate quality on update:', qErr);
      }
    }

    const textForHash = updates.cleaned_text || updates.original_text || existing.cleaned_text || existing.original_text || '';
    if (textForHash && (!existing.normalized_content_hash || updates.cleaned_text || updates.original_text)) {
      const h = generateContentHash(textForHash);
      updates.normalized_content_hash = h;
      updates.content_hash = h;
    }

    if (updates.status && updates.status !== existing.status) {
      if (!this.isValidTransition(existing.status, updates.status)) {
        throw new Error(`Invalid status transition from ${existing.status} to ${updates.status}`);
      }
    }

    let updated: Confession | null = null;

    // 1. Update in mockStore
    try {
      const mockUp = mockStore.updateConfession(existing.id, updates);
      if (mockUp) {
        updated = mockUp;
        mockStore.addLog({
          action: 'EDITED',
          entity_type: 'confession',
          entity_id: existing.id,
          metadata: { changed: Object.keys(updates) },
        });
      }
    } catch (mErr) {
      console.warn('[ConfessionService] mockStore update error:', mErr);
    }

    // 2. Update in Supabase if configured
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        const safeUpdates: any = { ...updates, updated_at: new Date().toISOString() };
        if (safeUpdates.status === 'DELETED') {
          delete safeUpdates.status;
        }
        delete safeUpdates.deleted_at;
        delete safeUpdates.scheduling_strategy;
        delete safeUpdates.scheduling_gap_minutes;
        delete safeUpdates.scheduling_reason;
        delete safeUpdates.scheduling_confidence;
        delete safeUpdates.scheduling_evidence_count;
        delete safeUpdates.experiment_id;
        delete safeUpdates.experiment_variant;
        delete safeUpdates.slides;
        delete safeUpdates.format;
        delete safeUpdates.content_category;

        const { data, error } = await supabase
          .from('confessions')
          .update(safeUpdates)
          .eq('id', existing.id)
          .select()
          .single();

        if (!error && data) {
          updated = this.decodeSupabaseRow(data) as Confession;
        }
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase updateConfession error:', sbErr);
      }
    }

    if (!updated) {
      updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    }

    return updated;
  }

  /**
   * Delete confession (soft delete moves to Deleted section; permanent completely purges)
   * Also updates Google Sheet and recalculates future queue timing!
   */
  public async deleteConfession(id: string, permanent: boolean = false): Promise<boolean> {
    const cleanId = String(id || '').trim();
    const confession = await this.getConfessionById(cleanId);
    if (!confession) {
      console.warn(`[ConfessionService] deleteConfession: confession not found for ID "${cleanId}"`);
      return false;
    }

    let success = false;

    // 1. Always execute in mockStore
    try {
      const mockResult = mockStore.deleteConfession(confession.id, permanent);
      if (mockResult) success = true;
    } catch (mErr) {
      console.warn('[ConfessionService] mockStore delete error:', mErr);
    }

    // 2. Record google_sheet_row in deletedRowNumbers so syncGoogleSheet NEVER re-imports it!
    if (confession.google_sheet_row) {
      try {
        const deletedRows = mockStore.getDeletedRowNumbers();
        deletedRows.add(confession.google_sheet_row);
        mockStore.setDeletedRowNumbers(Array.from(deletedRows));
      } catch (drErr) {
        console.warn('[ConfessionService] Failed to record deletedRowNumbers:', drErr);
      }
    }

    // 3. Execute in Supabase if configured
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        if (permanent) {
          const { error } = await supabase.from('confessions').delete().eq('id', confession.id);
          if (!error) success = true;
        } else {
          // No-migration soft-delete workaround: encode as REJECTED + __DELETED__ marker
          const deletedMarker = `__DELETED__:${new Date().toISOString()}`;
          const { error } = await supabase
            .from('confessions')
            .update({
              status: 'REJECTED',
              error_message: deletedMarker,
              scheduled_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', confession.id);
          if (!error) success = true;
        }
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase delete error:', sbErr);
      }
    }

    // If confession was found in our system, consider delete successful
    if (!success && confession) {
      success = true;
    }

    if (success) {
      // 4. Mark in Google Sheets as DELETED so the spreadsheet reflects user action
      const sheetConfig = mockStore.getGoogleSheetConfig();
      if (confession.google_sheet_row) {
        googleSheetsService
          .updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'DELETED',
            error: 'Deleted by user in ConfessionFlow',
          })
          .catch((err) => {
            console.warn('[ConfessionService] Failed to sync DELETED status to Google Sheet:', err);
          });
      }

      // 2. Automatically recalculate schedule so all remaining queue items update their timing!
      try {
        const { schedulingService } = await import('@/services/schedulingService');
        await schedulingService.generateFutureSchedule({ forceRecalculate: true });
      } catch (recalcErr) {
        console.warn('[ConfessionService] Failed to recalculate schedule after deletion:', recalcErr);
      }
    }

    return success;
  }

  /**
   * Create a new confession record (used by Google Sheet sync when Supabase is active)
   */
  public async createConfession(confession: Omit<Confession, 'id' | 'created_at' | 'updated_at'>): Promise<Confession | null> {
    if (!this.useSupabase()) {
      return null;
    }
    try {
      const supabase = createServerSupabaseClient();
      const safeRow: any = {
        google_sheet_id: confession.google_sheet_id,
        google_sheet_name: confession.google_sheet_name,
        google_sheet_row: confession.google_sheet_row,
        name: confession.name,
        original_text: confession.original_text,
        cleaned_text: confession.cleaned_text,
        display_name: confession.display_name,
        is_anonymous: confession.is_anonymous,
        status: confession.status,
        moderation_status: confession.moderation_status,
        moderation_reason: confession.moderation_reason,
        ai_processed: confession.ai_processed ?? false,
        template_id: confession.template_id ?? null,
        caption: confession.caption ?? null,
        hashtags: confession.hashtags ?? [],
        scheduled_at: confession.scheduled_at ?? null,
        published_at: confession.published_at ?? null,
        instagram_media_id: confession.instagram_media_id ?? null,
        instagram_permalink: confession.instagram_permalink ?? null,
        retry_count: confession.retry_count ?? 0,
        error_message: confession.error_message ?? null,
      };
      const { data, error } = await supabase
        .from('confessions')
        .insert(safeRow)
        .select()
        .single();
      if (error) {
        console.error('[ConfessionService] createConfession failed:', error.message);
        return null;
      }
      return this.decodeSupabaseRow(data) as Confession;
    } catch (err) {
      console.warn('[ConfessionService] createConfession exception:', err);
      return null;
    }
  }

  /**
   * Restore confession from Deleted section back to active queue
   */
  public async restoreConfession(id: string): Promise<Confession | null> {
    const cleanId = String(id || '').trim();
    const confession = await this.getConfessionById(cleanId);
    if (!confession) return null;

    let updated: Confession | null = null;

    // 1. Restore in mockStore
    try {
      const mockRestored = mockStore.restoreConfession(confession.id);
      if (mockRestored) updated = mockRestored;
    } catch (mErr) {
      console.warn('[ConfessionService] mockStore restore error:', mErr);
    }

    // 2. Remove row from deletedRowNumbers
    if (confession.google_sheet_row) {
      try {
        const deletedRows = mockStore.getDeletedRowNumbers();
        deletedRows.delete(confession.google_sheet_row);
        mockStore.setDeletedRowNumbers(Array.from(deletedRows));
      } catch {}
    }

    // 3. Restore in Supabase if configured
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase
          .from('confessions')
          .update({
            status: 'APPROVED',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', confession.id)
          .select()
          .single();
        if (!error && data) {
          updated = this.decodeSupabaseRow(data) as Confession;
        }
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase restore error:', sbErr);
      }
    }

    if (updated) {
      // 4. Update Google Sheet status back to APPROVED
      const sheetConfig = mockStore.getGoogleSheetConfig();
      if (updated.google_sheet_row) {
        googleSheetsService
          .updateRowStatus(sheetConfig, updated.google_sheet_row, {
            status: 'APPROVED',
            error: '',
          })
          .catch((err) => {
            console.warn('[ConfessionService] Failed to sync APPROVED status to Google Sheet on restore:', err);
          });
      }

      // 5. Automatically recalculate schedule so restored item is slotted into timing
      try {
        const { schedulingService } = await import('@/services/schedulingService');
        await schedulingService.generateFutureSchedule({ forceRecalculate: true });
      } catch (recalcErr) {
        console.warn('[ConfessionService] Failed to recalculate schedule after restore:', recalcErr);
      }
    }

    return updated;
  }

  public async bulkDelete(ids: string[], permanent: boolean = false): Promise<{ deleted: string[]; failed: string[] }> {
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const ok = await this.deleteConfession(id, permanent);
      if (ok) deleted.push(id);
      else failed.push(id);
    }
    return { deleted, failed };
  }

  public async bulkRestore(ids: string[]): Promise<{ restored: string[]; failed: string[] }> {
    const restored: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const res = await this.restoreConfession(id);
      if (res) restored.push(id);
      else failed.push(id);
    }
    return { restored, failed };
  }

  /**
   * Process confession with AI, Moderation, and generate initial 1080x1080 image card
   */
  public async processConfession(id: string): Promise<Confession> {
    const confession = await this.getConfessionById(id);
    if (!confession) throw new Error(`Confession not found: ${id}`);

    // Update status to PROCESSING
    await this.updateConfession(id, { status: 'PROCESSING' });

    try {
      // 1. Run AI service
      const aiResult = await aiService.processConfession(
        confession.original_text,
        confession.name,
        confession.is_anonymous,
        confession.google_sheet_row || 1
      );

      // Determine next status:
      let nextStatus: ConfessionStatus = 'READY_FOR_REVIEW';
      if (aiResult.moderationRisk === 'HIGH') {
        // High risk requires explicit admin review or stays rejected
        nextStatus = 'READY_FOR_REVIEW';
      }

      // 2. Fetch default template if none assigned
      const templateId = confession.template_id || mockStore.getSettings().default_template_id || (mockStore.getTemplates()[0]?.id ?? '44444444-4444-4444-4444-444444444444');
      const template = mockStore.getTemplateById(templateId) || mockStore.getTemplates().find(t => t.id === '44444444-4444-4444-4444-444444444444') || mockStore.getTemplates()[0];

      // 3. Generate initial preview card
      const settings = mockStore.getSettings();
      const updatedData: Partial<Confession> = {
        cleaned_text: aiResult.cleanedText,
        display_name: aiResult.displayName,
        caption: aiResult.caption,
        hashtags: aiResult.hashtags,
        moderation_status: aiResult.moderationRisk,
        moderation_reason: aiResult.moderationReason,
        ai_processed: true,
        status: nextStatus,
        template_id: templateId,
      };

      const imageResult = await imageService.generatePostImage({
        confession: { ...confession, ...updatedData } as Confession,
        template,
        brandName: settings.brand_name,
        instagramHandle: settings.instagram_handle,
        confessionNumber: confession.google_sheet_row || 1,
      });

      updatedData.generated_image_url = imageResult.publicUrl;
      updatedData.generated_image_path = imageResult.localPath;

      const updated = await this.updateConfession(id, updatedData);

      mockStore.addLog({
        action: 'AI_PROCESSED',
        entity_type: 'confession',
        entity_id: id,
        metadata: {
          risk: aiResult.moderationRisk,
          action: aiResult.recommendedAction,
        },
      });

      return updated;
    } catch (err: any) {
      await this.updateConfession(id, {
        status: 'READY_FOR_REVIEW',
        error_message: `AI processing failed: ${err?.message || err}`,
      });
      throw err;
    }
  }

  /**
   * Approve confession
   */
  public async approveConfession(id: string): Promise<Confession> {
    const confession = await this.getConfessionById(id);
    if (!confession) throw new Error('Confession not found');

    const isQualityOverride = confession.quality_status === 'LOW_VALUE';
    const updates: Partial<Confession> = {
      status: 'APPROVED',
      error_message: null,
    };

    if (isQualityOverride) {
      updates.quality_override = true;
      updates.quality_override_by = 'admin';
      updates.quality_override_at = new Date().toISOString();
      updates.quality_override_reason = 'Approved by admin override';
      if (confession.quality_decision === 'REJECT') {
        updates.quality_false_positive = true;
      }
    }

    const updated = await this.updateConfession(id, updates);

    mockStore.addLog({
      action: isQualityOverride ? 'QUALITY_OVERRIDE' : 'APPROVED',
      entity_type: 'confession',
      entity_id: id,
      metadata: {
        previousStatus: confession.status,
        previousQualityScore: confession.quality_score,
        previousQualityDecision: confession.quality_decision,
        overrideAction: 'APPROVE',
      },
    });

    return updated;
  }

  /**
   * Reject confession with a clear reason
   */
  public async rejectConfession(id: string, reason: string = 'Rejected by Admin'): Promise<Confession> {
    const confession = await this.getConfessionById(id);
    const updates: Partial<Confession> = {
      status: 'REJECTED',
      moderation_reason: reason,
    };

    if (confession && confession.quality_decision === 'APPROVE') {
      updates.quality_false_negative = true;
    }

    const updated = await this.updateConfession(id, updates);

    // Update status in Google Sheet as well
    const sheetConfig = mockStore.getGoogleSheetConfig();
    if (updated.google_sheet_row) {
      await googleSheetsService.updateRowStatus(sheetConfig, updated.google_sheet_row, {
        status: 'REJECTED',
        error: reason,
      });
    }

    mockStore.addLog({
      action: 'REJECTED',
      entity_type: 'confession',
      entity_id: id,
      metadata: { reason },
    });

    return updated;
  }

  /**
   * Schedule confession for automated future publication
   */
  public async scheduleConfession(id: string, scheduledAtIso: string): Promise<Confession> {
    const confession = await this.getConfessionById(id);
    if (!confession) throw new Error('Confession not found');

    if (!['APPROVED', 'READY_FOR_REVIEW'].includes(confession.status)) {
      throw new Error('Only approved or ready-for-review confessions can be scheduled');
    }

    if (
      ['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(confession.reconciliation_status as any) ||
      confession.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
      confession.status === 'UNKNOWN_NEEDS_REVIEW' ||
      confession.status === 'UNKNOWN'
    ) {
      throw new Error(`Cannot schedule confession with unconfirmed reconciliation status: ${confession.reconciliation_status || confession.status}. Reconciliation required.`);
    }

    const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
    const updated = await adaptiveSchedulingEngine.scheduleNextCandidate(confession, { forceTime: scheduledAtIso });

    const sheetConfig = mockStore.getGoogleSheetConfig();
    if (updated.google_sheet_row) {
      await googleSheetsService.updateRowStatus(sheetConfig, updated.google_sheet_row, {
        status: 'SCHEDULED',
      });
    }

    mockStore.addLog({
      action: 'SCHEDULED',
      entity_type: 'confession',
      entity_id: id,
      metadata: { scheduledAt: scheduledAtIso },
    });

    return updated;
  }

  /**
   * Cancel scheduled publishing
   */
  public async cancelSchedule(id: string): Promise<Confession> {
    const updated = await this.updateConfession(id, {
      status: 'APPROVED',
      scheduled_at: null,
    });

    mockStore.addLog({
      action: 'EDITED',
      entity_type: 'confession',
      entity_id: id,
      metadata: { note: 'Cancelled schedule' },
    });

    return updated;
  }

  /**
   * Publish confession to Instagram with strict concurrency lock, duplicate prevention, and sheet sync
   */
  public async publishConfession(
    id: string,
    options?: {
      cardMode?: 'fit' | 'hook' | 'carousel' | 'auto' | 'reel';
      customCaption?: string;
      templateId?: string;
      videoUrl?: string;
    }
  ): Promise<Confession> {
    // 1. Lock check to prevent double-click race condition
    if (this.publishingLocks.has(id)) {
      throw new Error('This confession is currently being published. Please wait.');
    }

    const confession = await this.getConfessionById(id);
    if (!confession) throw new Error('Confession not found');

    // 2. Strict pre-publish idempotency & state check via canonical publicationReconciliationService
    const preCheck = await publicationReconciliationService.finalPublicationCheck(confession);
    if (!preCheck.canPublish) {
      throw new Error(`Publishing blocked by reconciliation check: ${preCheck.reason}`);
    }

    // 2a. Strict duplicate and state checks
    if (confession.status === 'PUBLISHED' || confession.instagram_media_id) {
      throw new Error(`Already published! (Instagram Media ID: ${confession.instagram_media_id})`);
    }

    if (confession.status === 'REJECTED') {
      throw new Error('Cannot publish a rejected confession. Please approve it first.');
    }

    // 2b. Validate publish eligibility through Quality Gate and Safety Guards (Step 16 & 31)
    const settings = mockStore.getSettings();
    const eligibility = validatePublishEligibility(confession, settings);
    if (!eligibility.isEligible) {
      throw new Error(`Publishing blocked: ${eligibility.reason}`);
    }

    // 2c. Content hash canonical duplicate check against already published confessions
    const confessionText = confession.cleaned_text || confession.original_text || '';
    const contentHash = generateContentHash(confessionText);
    confession.normalized_content_hash = contentHash;
    confession.content_hash = contentHash;

    const allConfessions = mockStore.getConfessions();
    const duplicatePublished = allConfessions.find(
      (c) =>
        c.id !== id &&
        c.status === 'PUBLISHED' &&
        (c.normalized_content_hash === contentHash || c.content_hash === contentHash)
    );

    if (duplicatePublished) {
      await this.updateConfession(id, {
        status: 'DUPLICATE_ALREADY_PUBLISHED',
        duplicate_of_id: duplicatePublished.id,
        duplicate_of_row: duplicatePublished.google_sheet_row ?? null,
        duplicate_of_permalink: duplicatePublished.instagram_permalink ?? null,
        instagram_media_id: duplicatePublished.instagram_media_id,
        instagram_permalink: duplicatePublished.instagram_permalink,
        reconciliation_status: 'DUPLICATE',
        reconciliation_notes: `Identical confession already published as #${duplicatePublished.google_sheet_row || duplicatePublished.id}`,
      });
      throw new Error(
        `Duplicate blocked: This confession has already been published as #${duplicatePublished.google_sheet_row || duplicatePublished.id} (${duplicatePublished.instagram_permalink || ''})`
      );
    }

    // 2d. Check internal published posts ledger
    const publishedLedger = mockStore.getPublishedPosts();
    const ledgerMatch = publishedLedger.find((p) => {
      if (p.confession_id === id) return true;
      if (confession.google_sheet_row && p.confession_number === confession.google_sheet_row) return true;
      if (p.preview_text && normalizeConfessionText(p.preview_text) === normalizeConfessionText(confessionText)) return true;
      return false;
    });

    if (ledgerMatch) {
      await this.updateConfession(id, {
        status: 'PUBLISHED',
        instagram_media_id: ledgerMatch.instagram_media_id,
        instagram_permalink: ledgerMatch.permalink,
        published_at: ledgerMatch.published_at,
        reconciliation_status: 'ALREADY_PUBLISHED',
        reconciliation_notes: 'Found in published posts ledger before publish attempt.',
      });
      throw new Error(`Already published: Post verified in published posts ledger (Media ID: ${ledgerMatch.instagram_media_id})`);
    }

    // 2d. Attempt count limit check (MAX 3 attempts)
    const currentAttempts = confession.retry_count || 0;
    if (currentAttempts >= 3) {
      await this.updateConfession(id, {
        status: 'FAILED_REQUIRES_ACTION',
        error_message: 'Maximum publish attempts (3) reached. Manual admin action required.',
      });
      throw new Error('Maximum publish attempts (3) reached for this confession. Requires manual review.');
    }

    // 2e. Groq AI semantic duplicate check against published posts
    const publishedPool = allConfessions
      .filter((c) => c.status === 'PUBLISHED' && c.id !== id)
      .map((c) => ({
        row: c.google_sheet_row || 0,
        text: c.cleaned_text || c.original_text,
        id: c.id,
      }));

    if (publishedPool.length > 0) {
      const dup = await aiService.checkDuplicateWithGroq(
        confession.cleaned_text || confession.original_text,
        publishedPool
      );
      if (dup.isDuplicate && dup.confidence >= 0.85) {
        throw new Error(
          `AI Duplicate Detected: This confession matches published confession #${dup.duplicateOfRow} (${dup.reason})`
        );
      }
    }

    // Set lock
    this.publishingLocks.add(id);

    try {
      // 3. Mark state as PUBLISHING with idempotency key
      const attemptNumber = currentAttempts + 1;
      const idempotencyKey = createPublishIdempotencyKey(confession.id, attemptNumber);
      const publishAttemptId = `attempt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      await this.updateConfession(id, {
        status: 'PUBLISHING',
        content_hash: contentHash,
        normalized_content_hash: contentHash,
        idempotency_key: idempotencyKey,
        publishing_attempt_id: publishAttemptId,
        error_message: null,
      });

      mockStore.addLog({
        action: 'PUBLISH_STARTED',
        entity_type: 'confession',
        entity_id: id,
        metadata: { attempt: attemptNumber, idempotencyKey },
      });

      // 4. Resolve template and formatting mode
      const defaultTemplateId = mockStore.getSettings().default_template_id;
      const targetTemplateId = options?.templateId || confession.template_id || defaultTemplateId || '44444444-4444-4444-4444-444444444444';
      const template = mockStore.getTemplateById(targetTemplateId) || mockStore.getTemplateById(defaultTemplateId) || mockStore.getTemplates().find(t => t.id === '44444444-4444-4444-4444-444444444444') || mockStore.getTemplates()[0];
      const settings = mockStore.getSettings();

      const sourceText = (confession.cleaned_text || confession.original_text || '').trim();
      const requestedMode = options?.cardMode || 'auto';
      const pagination = paginateConfession(sourceText);

      let effectiveMode: 'fit' | 'hook' | 'carousel' = 'fit';
      if (requestedMode === 'carousel') {
        effectiveMode = 'carousel';
      } else if (requestedMode === 'hook') {
        effectiveMode = 'hook';
      } else if (requestedMode === 'fit') {
        effectiveMode = 'fit';
      } else {
        // 'auto' mode: if more than 1 slide needed to fit safely, use carousel
        effectiveMode = pagination.totalSlides > 1 ? 'carousel' : 'fit';
      }

      let generatedPublicUrls: string[] = [];
      let fullCaption = '';

      if (requestedMode === 'reel') {
        const videoUrl = options?.videoUrl;
        if (!videoUrl) {
          throw new Error('A valid public video URL is required to publish an Instagram Reel.');
        }
        fullCaption = (options?.customCaption && options.customCaption.trim()) ||
          buildInstagramCaption({
            confessionNumber: confession.google_sheet_row || 1,
            hashtags: confession.hashtags || [],
            mode: 'fit',
          });

        await this.updateConfession(id, {
          template_id: template.id,
          generated_image_url: videoUrl,
        });
      } else if (effectiveMode === 'fit') {
        // Enforce fit requirement: check if text can safely fit on single card
        if (!canFitOnSingleCard(sourceText, template)) {
          throw new Error('This confession does not safely fit on one card without clipping. Please use Carousel format.');
        }

        const imgRes = await imageService.generatePostImage({
          confession,
          template,
          brandName: settings.brand_name,
          instagramHandle: settings.instagram_handle,
          confessionNumber: confession.google_sheet_row || 1,
        });
        generatedPublicUrls = [imgRes.publicUrl];

        await this.updateConfession(id, {
          template_id: template.id,
          generated_image_url: imgRes.publicUrl,
          generated_image_path: imgRes.localPath,
        });

        fullCaption = (options?.customCaption && options.customCaption.trim()) ||
          buildInstagramCaption({
            confessionNumber: confession.google_sheet_row || 1,
            hashtags: confession.hashtags || [],
            mode: 'fit',
          });

        const validation = validatePublicationPayload({
          sourceConfession: sourceText,
          slides: [sourceText],
          mode: 'fit',
          caption: fullCaption,
        });
        if (!validation.valid) {
          throw new Error(`Pre-publication validation failed: ${validation.errors.join('; ')}`);
        }
      } else if (effectiveMode === 'hook') {
        const hookText = createHookText(sourceText);
        const imgRes = await imageService.generatePostImage({
          confession: { ...confession, cleaned_text: hookText },
          template,
          brandName: settings.brand_name,
          instagramHandle: settings.instagram_handle,
          confessionNumber: confession.google_sheet_row || 1,
        });
        generatedPublicUrls = [imgRes.publicUrl];

        await this.updateConfession(id, {
          template_id: template.id,
          generated_image_url: imgRes.publicUrl,
          generated_image_path: imgRes.localPath,
        });

        fullCaption = (options?.customCaption && options.customCaption.trim()) ||
          buildInstagramCaption({
            confessionNumber: confession.google_sheet_row || 1,
            hashtags: confession.hashtags || [],
            mode: 'hook',
            sourceConfession: sourceText,
          });

        const validation = validatePublicationPayload({
          sourceConfession: sourceText,
          slides: [hookText],
          mode: 'hook',
          caption: fullCaption,
        });
        if (!validation.valid) {
          throw new Error(`Pre-publication validation failed: ${validation.errors.join('; ')}`);
        }
      } else {
        // Carousel mode
        const slideTexts = pagination.slides.map((s) => s.text);
        if (slideTexts.length > 10) {
          throw new Error(
            `This confession is too long for one Instagram carousel (has ${slideTexts.length} slides, platform limit is 10). Please shorten it.`
          );
        }

        const isPreserved = verifyContentPreservation(sourceText, slideTexts);
        if (!isPreserved) {
          throw new Error(
            'Unable to safely paginate the confession without losing content. Source text and slide content mismatch.'
          );
        }

        fullCaption = (options?.customCaption && options.customCaption.trim()) ||
          buildInstagramCaption({
            confessionNumber: confession.google_sheet_row || 1,
            hashtags: confession.hashtags || [],
            mode: 'carousel',
          });

        const validation = validatePublicationPayload({
          sourceConfession: sourceText,
          slides: slideTexts,
          mode: 'carousel',
          caption: fullCaption,
        });
        if (!validation.valid) {
          throw new Error(`Pre-publication validation failed: ${validation.errors.join('; ')}`);
        }

        const slideImages = await imageService.generateSlideImages({
          confession,
          template,
          brandName: settings.brand_name,
          instagramHandle: settings.instagram_handle,
          confessionNumber: confession.google_sheet_row || 1,
          slides: slideTexts,
        });

        generatedPublicUrls = slideImages.map((s) => s.publicUrl);

        await this.updateConfession(id, {
          template_id: template.id,
          generated_image_url: generatedPublicUrls[0],
          generated_image_path: slideImages[0]?.localPath || null,
        });
      }

      // Pre-call atomic idempotency check right before external network transmission
      const preSendCheck = await publicationReconciliationService.finalPublicationCheck(confession);
      if (!preSendCheck.canPublish) {
        throw new Error(`Publishing aborted: ${preSendCheck.reason}`);
      }

      // 5. Call Instagram Service (reel, carousel, or single post)
      let publishResult;
      if (requestedMode === 'reel') {
        publishResult = await instagramService.publishReel(confession, options?.videoUrl!, fullCaption);
      } else if (generatedPublicUrls.length > 1) {
        publishResult = await instagramService.publishCarousel(confession, generatedPublicUrls, fullCaption);
      } else {
        publishResult = await instagramService.publishPost(confession, generatedPublicUrls[0], fullCaption);
      }

      if (!publishResult.success) {
        const newRetryCount = (confession.retry_count || 0) + 1;

        if (publishResult.isUnknownState) {
          // Never equate timeout/network drop with failure — status is UNKNOWN
          await this.updateConfession(id, {
            status: 'UNKNOWN_NEEDS_REVIEW',
            retry_count: newRetryCount,
            reconciliation_status: 'UNKNOWN',
            reconciliation_notes: 'Publish attempt timed out or dropped connection. Reconcile with Instagram before retrying.',
            error_message: publishResult.error || 'Publish outcome unknown (network timeout/drop).',
          });

          const sheetConfig = mockStore.getGoogleSheetConfig();
          if (confession.google_sheet_row) {
            await googleSheetsService.updateRowStatus(sheetConfig, confession.google_sheet_row, {
              status: 'UNKNOWN',
              error: 'Publish outcome unknown (timeout). Requires reconciliation.',
            }).catch(() => {});
          }

          mockStore.addLog({
            action: 'PUBLISH_FAILED',
            entity_type: 'confession',
            entity_id: id,
            metadata: { error: publishResult.error, isUnknownState: true, retry_count: newRetryCount },
          });

          throw new Error(publishResult.error || 'Instagram publish state unknown');
        }

        const nextStatus: ConfessionStatus = newRetryCount >= 3 ? 'FAILED_REQUIRES_ACTION' : 'FAILED_CONFIRMED';

        await this.updateConfession(id, {
          status: nextStatus,
          retry_count: newRetryCount,
          error_message: publishResult.error || 'Failed to publish post',
          reconciliation_status: 'CONFIRMED_NOT_PUBLISHED',
          reconciliation_notes: 'Confirmed failed before publication on Instagram.',
        });

        // Update Google Sheet with error
        const sheetConfig = mockStore.getGoogleSheetConfig();
        if (confession.google_sheet_row) {
          await googleSheetsService.updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'FAILED',
            error: publishResult.error || 'Publishing error',
          }).catch(() => {});
        }

        mockStore.addLog({
          action: 'PUBLISH_FAILED',
          entity_type: 'confession',
          entity_id: id,
          metadata: { error: publishResult.error, retry_count: newRetryCount },
        });

        throw new Error(publishResult.error || 'Instagram publishing failed');
      }

      // 6. Success: Transition to PUBLISHED
      const publishedAt = new Date().toISOString();

      // Immediate ledger recording to guarantee idempotency even if DB/Sheet updates encounter glitches
      mockStore.addPublishedPost({
        confession_id: id,
        confession_number: confession.google_sheet_row ?? 0,
        instagram_media_id: publishResult.mediaId ?? '',
        permalink: publishResult.permalink ?? '',
        published_at: publishedAt,
        template_name: mockStore.getTemplateById(confession.template_id ?? '')?.name,
        preview_text: (confession.cleaned_text || confession.original_text || '').slice(0, 80),
      });

      const updated = await this.updateConfession(id, {
        status: 'PUBLISHED',
        published_at: publishedAt,
        instagram_media_id: publishResult.mediaId,
        instagram_permalink: publishResult.permalink,
        error_message: null,
        reconciliation_status: 'ALREADY_PUBLISHED',
        reconciliation_notes: 'Successfully published to Instagram.',
      });

      // 7. Update Google Sheet — status only (non-blocking in production so UI returns instantly)
      const sheetConfig = mockStore.getGoogleSheetConfig();
      if (confession.google_sheet_row) {
        console.log(`[ConfessionService] Marking Google Sheet row #${confession.google_sheet_row} as PUBLISHED...`);
        const sheetUpdatePromise = googleSheetsService
          .updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'PUBLISHED',
            processedAt: publishedAt,
            error: '',
          })
          .then((sheetOk) => {
            if (sheetOk) {
              console.log(`[ConfessionService] Successfully marked row #${confession.google_sheet_row} as PUBLISHED on Google Sheet.`);
            } else {
              console.warn(`[ConfessionService] Warning: Could not write PUBLISHED status to row #${confession.google_sheet_row} on Google Sheet.`);
            }
          })
          .catch((sheetErr: any) => {
            console.error(`[ConfessionService] Error updating Google Sheet row #${confession.google_sheet_row}:`, sheetErr?.message || sheetErr);
          });

        if (process.env.NODE_ENV === 'test') {
          await sheetUpdatePromise;
        }
      }



      // 9. Log success
      mockStore.addLog({
        action: 'PUBLISHED',
        entity_type: 'confession',
        entity_id: id,
        metadata: {
          media_id: publishResult.mediaId,
          permalink: publishResult.permalink,
        },
      });

      // 10. Asynchronous post-publish analytics registration (completely non-blocking, failures never affect post status)
      try {
        import('@/services/growth/analyticsCollector')
          .then(({ analyticsCollector }) => {
            if (publishResult.mediaId && publishResult.permalink) {
              const detectedFormat: any =
                options?.cardMode === 'reel'
                  ? 'REEL'
                  : options?.cardMode === 'carousel'
                  ? 'CAROUSEL'
                  : 'IMAGE';

              analyticsCollector
                .registerPublishedMedia(
                  updated,
                  { mediaId: publishResult.mediaId, permalink: publishResult.permalink },
                  detectedFormat
                )
                .catch((err) => {
                  console.warn('[ConfessionService] Non-blocking analytics registration notice:', err?.message || err);
                });
            }
          })
          .catch(() => {});
      } catch {}

      return updated;
    } finally {
      this.publishingLocks.delete(id);
    }
  }

  /**
   * Bulk approve
   */
  public async bulkApprove(ids: string[]): Promise<{ approved: string[]; failed: string[] }> {
    const approved: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      try {
        await this.approveConfession(id);
        approved.push(id);
      } catch {
        failed.push(id);
      }
    }

    return { approved, failed };
  }

  /**
   * Bulk reject
   */
  public async bulkReject(ids: string[], reason: string): Promise<{ rejected: string[]; failed: string[] }> {
    const rejected: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      try {
        await this.rejectConfession(id, reason);
        rejected.push(id);
      } catch {
        failed.push(id);
      }
    }

    return { rejected, failed };
  }

  /**
   * Restart failed confessions in queue.
   * STRICT SAFETY GUARANTEES:
   * - NEVER uploads or resets REJECTED confessions.
   * - NEVER uploads or resets already PUBLISHED confessions (or confessions with an instagram_media_id).
   */
  public async restartFailedQueue(targetIds?: string[]): Promise<{
    success: boolean;
    restartedCount: number;
    restartedIds: string[];
    skippedRejected: number;
    skippedPublished: number;
  }> {
    const all = mockStore.getConfessions();
    const settings = mockStore.getSettings();
    const sheetConfig = mockStore.getGoogleSheetConfig();

    const candidates = targetIds && targetIds.length > 0
      ? all.filter((c) => targetIds.includes(c.id))
      : all.filter((c) => c.status === 'FAILED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED_REQUIRES_ACTION');

    const restartedIds: string[] = [];
    let skippedRejected = 0;
    let skippedPublished = 0;

    const nextStatus: ConfessionStatus =
      settings.auto_publish === true && settings.publishing_mode === 'AUTO_PUBLISH'
        ? 'APPROVED'
        : 'READY_FOR_REVIEW';

    for (const confession of candidates) {
      // 1. Strict guard: NEVER touch or upload REJECTED confessions
      if (confession.status === 'REJECTED' || confession.moderation_status === 'HIGH') {
        skippedRejected++;
        continue;
      }

      // 2. Strict guard: NEVER touch or upload already PUBLISHED or DUPLICATE confessions
      if (
        confession.status === 'PUBLISHED' ||
        confession.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
        confession.instagram_media_id ||
        confession.published_at
      ) {
        skippedPublished++;
        continue;
      }

      // 2b. Strict guard: NEVER restart UNKNOWN without reconciliation
      if (confession.status === 'UNKNOWN' || confession.status === 'UNKNOWN_NEEDS_REVIEW') {
        continue;
      }

      // 3. Reset failed confession back into queue
      try {
        const updateFields: Partial<Confession> = {
          status: nextStatus,
          scheduled_at: null,
          error_message: null,
          retry_count: 0,
          generated_image_url: null,
          generated_image_path: null,
        };

        // If PII detection is disabled by user, unmask social handles/PII from original submission
        if (settings.enable_pii_detection === false) {
          const mod = moderationService.analyzeContent(confession.original_text, false);
          updateFields.cleaned_text = confession.original_text;
          updateFields.moderation_status = mod.risk;
          updateFields.moderation_reason = mod.reasons.length > 0 ? mod.reasons.join('; ') : 'Passed safety validation.';
          updateFields.generated_image_url = null; // Forces fresh card image render with real handle
          updateFields.generated_image_path = null;
        }

        await this.updateConfession(confession.id, updateFields);

        // 4. Update Google Sheet row status back to QUEUED if present
        if (confession.google_sheet_row) {
          googleSheetsService.updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'QUEUED',
            error: '',
          }).catch((err) => {
            console.warn(`[ConfessionService] Failed to reset sheet row #${confession.google_sheet_row}:`, err?.message || err);
          });
        }

        restartedIds.push(confession.id);
      } catch (err: any) {
        console.error(`[ConfessionService] Error restarting confession ${confession.id}:`, err?.message || err);
      }
    }

    mockStore.addLog({
      action: 'QUEUE_RESTARTED',
      entity_type: 'confession',
      metadata: {
        restartedCount: restartedIds.length,
        skippedRejected,
        skippedPublished,
      },
    });

    return {
      success: true,
      restartedCount: restartedIds.length,
      restartedIds,
      skippedRejected,
      skippedPublished,
    };
  }

  /**
   * Synchronize all updated settings to existing unpublished confessions.
   * Handles:
   * - Default template assignment & invalidation of stale generated card images
   * - Brand name & Instagram handle updates (invalidates pre-rendered card images)
   * - Default hashtags and automatic caption generation
   * - PII & profanity moderation re-evaluation
   * - Content quality gate threshold adjustments
   * - Queue schedule recalculation when cadence, gaps, or operating hours change
   */
  public async syncSettingsToConfessions(updates: Partial<SystemSettings>): Promise<{
    updatedCount: number;
    scheduleRecalculated: boolean;
  }> {
    const currentSettings = mockStore.getSettings();

    const hasTemplateUpdate = !!updates.default_template_id;
    const hasBrandingUpdate = !!(updates.brand_name || updates.instagram_handle);
    const hasHashtagUpdate = Array.isArray(updates.default_hashtags);
    const hasPiiUpdate = updates.enable_pii_detection !== undefined;
    const hasProfanityUpdate = updates.enable_profanity_filter !== undefined || updates.risk_threshold !== undefined;
    const hasQualityUpdate =
      updates.min_quality_score !== undefined ||
      updates.auto_reject_low_value !== undefined ||
      updates.enable_quality_gate !== undefined;

    const enablePii = updates.enable_pii_detection !== undefined
      ? Boolean(updates.enable_pii_detection)
      : (currentSettings.enable_pii_detection !== false);

    const minQualityScore = updates.min_quality_score ?? currentSettings.min_quality_score ?? 55;
    const autoRejectLowValue = updates.auto_reject_low_value ?? currentSettings.auto_reject_low_value ?? false;
    const qualityGateEnabled = updates.enable_quality_gate ?? currentSettings.enable_quality_gate ?? true;

    const modifiedConfessions: Confession[] = [];

    const updatedCount = mockStore.batchUpdateConfessions((c) => {
      // 1. Never touch already PUBLISHED confessions
      if (c.status === 'PUBLISHED' || c.published_at || c.instagram_media_id) {
        return null;
      }

      let changed = false;
      const cUpdates: Partial<Confession> = {};

      // 1. Template update
      if (hasTemplateUpdate && updates.default_template_id) {
        if (c.template_id !== updates.default_template_id) {
          cUpdates.template_id = updates.default_template_id;
          cUpdates.generated_image_url = null;
          cUpdates.generated_image_path = null;
          changed = true;
        }
      }

      // 2. Branding update (brand name or instagram handle changed -> pre-rendered image is invalid)
      if (hasBrandingUpdate) {
        if (c.generated_image_url || c.generated_image_path) {
          cUpdates.generated_image_url = null;
          cUpdates.generated_image_path = null;
          changed = true;
        }
      }

      // 3. Hashtags & Captions update
      if (hasHashtagUpdate && updates.default_hashtags) {
        cUpdates.hashtags = [...updates.default_hashtags];
        const newCaption = buildInstagramCaption({
          confessionNumber: c.google_sheet_row || 1,
          hashtags: updates.default_hashtags,
          mode: 'auto',
        });
        cUpdates.caption = newCaption;
        changed = true;
      }

      // 4. Moderation / PII update
      if (hasPiiUpdate || hasProfanityUpdate) {
        const mod = moderationService.analyzeContent(c.original_text, enablePii);
        let newCleanedText = c.cleaned_text || c.original_text;

        if (!enablePii) {
          newCleanedText = c.original_text;
        } else if (mod.piiDetected.length > 0) {
          newCleanedText = moderationService.maskSensitiveInformation(c.original_text, mod.piiDetected);
        }

        if (
          newCleanedText !== c.cleaned_text ||
          mod.risk !== c.moderation_status ||
          (mod.reasons.length > 0 ? mod.reasons.join('; ') : 'Passed safety validation.') !== c.moderation_reason
        ) {
          cUpdates.cleaned_text = newCleanedText;
          cUpdates.moderation_status = mod.risk;
          cUpdates.moderation_reason = mod.reasons.length > 0 ? mod.reasons.join('; ') : 'Passed safety validation.';
          cUpdates.generated_image_url = null;
          cUpdates.generated_image_path = null;
          changed = true;
        }
      }

      // 5. Quality gate update
      if (hasQualityUpdate && c.quality_score !== null && c.quality_score !== undefined) {
        if (!qualityGateEnabled) {
          if (c.quality_status !== 'GOOD' || c.quality_decision !== 'APPROVE') {
            cUpdates.quality_status = 'GOOD';
            cUpdates.quality_decision = 'APPROVE';
            if (c.status === 'REJECTED' && c.quality_category === 'LOW_INFORMATION') {
              cUpdates.status = 'READY_FOR_REVIEW';
            }
            changed = true;
          }
        } else {
          let newQualityStatus: any = c.quality_status;
          let newDecision: any = c.quality_decision;

          if (c.quality_score >= 80) {
            newQualityStatus = 'GOOD';
            newDecision = 'APPROVE';
          } else if (c.quality_score >= minQualityScore) {
            newQualityStatus = 'NEEDS_REVIEW';
            newDecision = 'REVIEW';
          } else {
            newQualityStatus = 'LOW_VALUE';
            newDecision = 'REJECT';
            if (autoRejectLowValue && c.status !== 'REJECTED') {
              cUpdates.status = 'REJECTED';
            }
          }

          if (newQualityStatus !== c.quality_status || newDecision !== c.quality_decision) {
            cUpdates.quality_status = newQualityStatus;
            cUpdates.quality_decision = newDecision;
            changed = true;
          }
        }
      }

      if (changed) {
        modifiedConfessions.push({ ...c, ...cUpdates });
        return cUpdates;
      }
      return null;
    });

    // Sync to Supabase if configured
    if (this.useSupabase() && modifiedConfessions.length > 0) {
      try {
        const supabase = createServerSupabaseClient();
        for (const c of modifiedConfessions) {
          const safeUpdates: any = {
            template_id: c.template_id,
            generated_image_url: c.generated_image_url,
            generated_image_path: c.generated_image_path,
            hashtags: c.hashtags,
            caption: c.caption,
            cleaned_text: c.cleaned_text,
            moderation_status: c.moderation_status,
            moderation_reason: c.moderation_reason,
            quality_status: c.quality_status,
            quality_decision: c.quality_decision,
            updated_at: new Date().toISOString(),
          };
          if (c.status !== 'DELETED') {
            safeUpdates.status = c.status;
          }
          await supabase.from('confessions').update(safeUpdates).eq('id', c.id);
        }
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase syncSettings error:', sbErr);
      }
    }

    // 6. Recalculate schedule if scheduling or operating hours parameters changed
    let scheduleRecalculated = false;
    const schedulingKeys: (keyof SystemSettings)[] = [
      'max_daily_posts',
      'min_daily_posts',
      'target_daily_posts',
      'auto_publish_start_hour',
      'auto_publish_end_hour',
      'auto_publish_interval_minutes',
      'min_gap_minutes',
      'max_gap_minutes',
      'scheduling_strategy_mode',
      'random_gap_enabled',
      'timezone',
      'scheduling_mode',
    ];

    const hasSchedulingChanges = schedulingKeys.some((k) => updates[k] !== undefined);
    if (hasSchedulingChanges) {
      try {
        const { schedulingService } = await import('@/services/schedulingService');
        await schedulingService.generateFutureSchedule({ forceRecalculate: true });
        scheduleRecalculated = true;
      } catch (schedErr) {
        console.warn('[ConfessionService] Failed to recalculate queue schedule after settings update:', schedErr);
      }
    }

    return { updatedCount, scheduleRecalculated };
  }

  /**
   * Invalidate cached image URLs and local paths for all unpublished confessions using a template
   */
  public async invalidateImagesForTemplate(templateId: string): Promise<number> {
    const updatedCount = mockStore.batchUpdateConfessions((c) => {
      if (c.status === 'PUBLISHED' || c.published_at || c.instagram_media_id) {
        return null;
      }
      if (c.template_id === templateId) {
        return {
          generated_image_url: null,
          generated_image_path: null,
        };
      }
      return null;
    });

    if (this.useSupabase() && updatedCount > 0) {
      try {
        const supabase = createServerSupabaseClient();
        await supabase
          .from('confessions')
          .update({
            generated_image_url: null,
            generated_image_path: null,
            updated_at: new Date().toISOString(),
          })
          .eq('template_id', templateId)
          .neq('status', 'PUBLISHED');
      } catch (sbErr) {
        console.warn('[ConfessionService] Supabase invalidateImages error:', sbErr);
      }
    }

    return updatedCount;
  }

  /**
   * Synchronize PII masking state for existing unpublished confessions.
   * If enablePii is false, unmasks social handles/PII and re-evaluates moderation risk.
   */
  public async syncPiiSettings(enablePii: boolean): Promise<number> {
    const res = await this.syncSettingsToConfessions({ enable_pii_detection: enablePii });
    return res.updatedCount;
  }

  /**
   * Calculate dashboard stats
   */
  public async getDashboardStats(): Promise<DashboardStats> {
    const all = !this.useSupabase()
      ? mockStore.getConfessions()
      : (await this.getConfessions({ limit: 1000 })).confessions;

    const todayStr = new Date().toISOString().slice(0, 10);
    const publishedToday = all.filter(
      (c) => c.status === 'PUBLISHED' && c.published_at?.startsWith(todayStr)
    ).length;

    const settings = mockStore.getSettings();

    return {
      total: all.filter((c) => c.status !== 'DELETED').length,
      pendingReview: all.filter((c) => c.status === 'READY_FOR_REVIEW').length,
      approved: all.filter((c) => c.status === 'APPROVED').length,
      scheduled: all.filter((c) => c.status === 'SCHEDULED').length,
      published: all.filter((c) => c.status === 'PUBLISHED').length,
      rejected: all.filter((c) => c.status === 'REJECTED').length,
      failed: all.filter((c) => c.status === 'FAILED' || c.status === 'FAILED_REQUIRES_ACTION').length,
      publishedToday,
      maxDailyPosts: settings.max_daily_posts || 8,
    };
  }

  /**
   * Fast tab counts for /confessions page tabs without downloading full entity payloads
   */
  public async getTabCounts(): Promise<{
    queue: number;
    scheduled: number;
    published: number;
    unknown: number;
    duplicates: number;
    low_value: number;
    deleted: number;
    failed: number;
    alreadyPublished?: number;
    confirmedNotPublished?: number;
    safeToRetry?: number;
    manualReview?: number;
    unreconciled?: number;
  }> {
    const all = !this.useSupabase()
      ? mockStore.getConfessions()
      : (await this.getConfessions({ limit: 1000 })).confessions;

    const queue = all.filter(
      (c) =>
        !['PUBLISHED', 'SCHEDULED', 'REJECTED', 'DELETED', 'FAILED', 'FAILED_CONFIRMED', 'FAILED_REQUIRES_ACTION', 'UNKNOWN', 'UNKNOWN_NEEDS_REVIEW', 'DUPLICATE_ALREADY_PUBLISHED', 'CANCELLED'].includes(c.status) &&
        c.quality_status !== 'LOW_VALUE'
    ).length;

    const scheduled = all.filter((c) => c.status === 'SCHEDULED').length;
    const published = all.filter((c) => c.status === 'PUBLISHED').length;
    const unknown = all.filter(
      (c) => c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW'
    ).length;
    const duplicates = all.filter(
      (c) => c.status === 'DUPLICATE_ALREADY_PUBLISHED'
    ).length;
    const low_value = all.filter(
      (c) =>
        c.status !== 'DELETED' &&
        (c.quality_status === 'LOW_VALUE' ||
          c.quality_decision === 'REJECT' ||
          (c.status === 'REJECTED' && c.quality_category === 'LOW_INFORMATION'))
    ).length;
    const deleted = all.filter((c) => c.status === 'DELETED').length;
    const failed = all.filter(
      (c) =>
        (c.status === 'FAILED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED_REQUIRES_ACTION') &&
        !c.instagram_media_id &&
        !c.published_at
    ).length;

    const alreadyPublished = all.filter(
      (c) => c.status === 'PUBLISHED' || c.reconciliation_status === 'ALREADY_PUBLISHED' || c.reconciliation_status === 'VERIFIED'
    ).length;
    const confirmedNotPublished = all.filter(
      (c) => c.reconciliation_status === 'CONFIRMED_NOT_PUBLISHED'
    ).length;
    const safeToRetry = all.filter(
      (c) =>
        c.reconciliation_status === 'CONFIRMED_NOT_PUBLISHED' &&
        (c.status === 'APPROVED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED')
    ).length;
    const manualReview = all.filter(
      (c) => c.reconciliation_status === 'MANUAL_REVIEW' || c.status === 'UNKNOWN_NEEDS_REVIEW'
    ).length;
    const unreconciled = all.filter(
      (c) =>
        c.reconciliation_status === 'NOT_CHECKED' ||
        c.reconciliation_status === 'CHECKING' ||
        (!c.reconciliation_status && (c.status === 'FAILED' || c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW'))
    ).length;

    return {
      queue,
      scheduled,
      published,
      unknown,
      duplicates,
      low_value,
      deleted,
      failed,
      alreadyPublished,
      confirmedNotPublished,
      safeToRetry,
      manualReview,
      unreconciled,
    };
  }
}

export const confessionService = new ConfessionService();
