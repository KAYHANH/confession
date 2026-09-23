import { Confession, ConfessionStatus, DashboardStats } from '@/types';
import { mockStore } from '@/lib/mockStore';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { aiService } from './aiService';
import { imageService } from './imageService';
import { instagramService } from './instagramService';
import { googleSheetsService } from './googleSheetsService';

// Valid status transitions map
export const ALLOWED_TRANSITIONS: Record<ConfessionStatus, ConfessionStatus[]> = {
  NEW: ['IMPORTED'],
  IMPORTED: ['PROCESSING'],
  PROCESSING: ['READY_FOR_REVIEW', 'REJECTED'],
  READY_FOR_REVIEW: ['APPROVED', 'REJECTED', 'PUBLISHING'],
  APPROVED: ['SCHEDULED', 'PUBLISHING', 'REJECTED'],
  REJECTED: ['READY_FOR_REVIEW', 'APPROVED'], // allow admin to overturn rejection
  SCHEDULED: ['PUBLISHING', 'APPROVED', 'REJECTED'], // allow rescheduling/cancelling
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [], // Terminal state, no further publishing
  FAILED: ['PUBLISHING', 'FAILED_REQUIRES_ACTION', 'REJECTED'],
  FAILED_REQUIRES_ACTION: ['PUBLISHING', 'REJECTED'],
};

export class ConfessionService {
  // In-memory mutex locks to ensure zero concurrent publishing race conditions
  private publishingLocks = new Set<string>();

  private useSupabase(): boolean {
    return (
      process.env.MOCK_EXTERNAL_APIS !== 'true' &&
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );
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
   * Get all confessions with filtering, search, and pagination
   */
  public async getConfessions(options: {
    status?: ConfessionStatus;
    moderationStatus?: string;
    search?: string;
    templateId?: string;
    sortBy?: 'newest' | 'oldest' | 'scheduled' | 'recently_published';
    page?: number;
    limit?: number;
  } = {}): Promise<{ confessions: Confession[]; total: number; page: number; totalPages: number }> {
    const { status, moderationStatus, search, templateId, sortBy = 'newest', page = 1, limit = 50 } = options;

    if (!this.useSupabase()) {
      let list = mockStore.getConfessions();

      if (status) {
        list = list.filter((c) => c.status === status);
      }
      if (moderationStatus) {
        list = list.filter((c) => c.moderation_status === moderationStatus);
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

    // Real Supabase query
    const supabase = createServerSupabaseClient();
    let query = supabase.from('confessions').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
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
    if (error) throw new Error(error.message);

    return {
      confessions: (data as Confession[]) || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit) || 1,
    };
  }

  /**
   * Get single confession by ID
   */
  public async getConfessionById(id: string): Promise<Confession | null> {
    if (!this.useSupabase()) {
      return mockStore.getConfessionById(id) || null;
    }
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from('confessions').select('*').eq('id', id).single();
    if (error) return null;
    return data as Confession;
  }

  /**
   * Update confession fields
   */
  public async updateConfession(id: string, updates: Partial<Confession>): Promise<Confession> {
    const existing = await this.getConfessionById(id);
    if (!existing) throw new Error(`Confession not found: ${id}`);

    if (updates.status && updates.status !== existing.status) {
      if (!this.isValidTransition(existing.status, updates.status)) {
        throw new Error(`Invalid status transition from ${existing.status} to ${updates.status}`);
      }
    }

    if (!this.useSupabase()) {
      const updated = mockStore.updateConfession(id, updates);
      if (!updated) throw new Error('Update failed');
      mockStore.addLog({
        action: 'EDITED',
        entity_type: 'confession',
        entity_id: id,
        metadata: { changed: Object.keys(updates) },
      });
      return updated;
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('confessions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Confession;
  }

  /**
   * Delete confession
   */
  public async deleteConfession(id: string): Promise<boolean> {
    if (!this.useSupabase()) {
      return mockStore.deleteConfession(id);
    }
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('confessions').delete().eq('id', id);
    return !error;
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
      const templateId = confession.template_id || mockStore.getSettings().default_template_id || (mockStore.getTemplates()[0]?.id ?? '77777777-7777-7777-7777-777777777777');
      const template = mockStore.getTemplateById(templateId) || mockStore.getTemplates().find(t => t.id === '77777777-7777-7777-7777-777777777777') || mockStore.getTemplates()[0];

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

    const updated = await this.updateConfession(id, {
      status: 'APPROVED',
      error_message: null,
    });

    mockStore.addLog({
      action: 'APPROVED',
      entity_type: 'confession',
      entity_id: id,
      metadata: { previousStatus: confession.status },
    });

    return updated;
  }

  /**
   * Reject confession with a clear reason
   */
  public async rejectConfession(id: string, reason: string = 'Rejected by Admin'): Promise<Confession> {
    const updated = await this.updateConfession(id, {
      status: 'REJECTED',
      moderation_reason: reason,
    });

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

    const updated = await this.updateConfession(id, {
      status: 'SCHEDULED',
      scheduled_at: scheduledAtIso,
    });

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
  public async publishConfession(id: string): Promise<Confession> {
    // 1. Lock check to prevent double-click race condition
    if (this.publishingLocks.has(id)) {
      throw new Error('This confession is currently being published. Please wait.');
    }

    const confession = await this.getConfessionById(id);
    if (!confession) throw new Error('Confession not found');

    // 2. Strict duplicate and state checks
    if (confession.status === 'PUBLISHED' || confession.instagram_media_id) {
      throw new Error(`Already published! (Instagram Media ID: ${confession.instagram_media_id})`);
    }

    if (confession.status === 'REJECTED') {
      throw new Error('Cannot publish a rejected confession. Please approve it first.');
    }

    // Set lock
    this.publishingLocks.add(id);

    try {
      // 3. Mark state as PUBLISHING
      await this.updateConfession(id, {
        status: 'PUBLISHING',
        error_message: null,
      });

      mockStore.addLog({
        action: 'PUBLISH_STARTED',
        entity_type: 'confession',
        entity_id: id,
        metadata: { attempt: (confession.retry_count || 0) + 1 },
      });

      // 4. Ensure card image is generated
      let imageUrl = confession.generated_image_url;
      if (!imageUrl) {
        const template = mockStore.getTemplateById(confession.template_id) || mockStore.getTemplateById(mockStore.getSettings().default_template_id) || mockStore.getTemplates().find(t => t.id === '77777777-7777-7777-7777-777777777777') || mockStore.getTemplates()[0];
        const settings = mockStore.getSettings();
        const imgRes = await imageService.generatePostImage({
          confession,
          template,
          brandName: settings.brand_name,
          instagramHandle: settings.instagram_handle,
          confessionNumber: confession.google_sheet_row || 1,
        });
        imageUrl = imgRes.publicUrl;
      }

      // Format caption with hashtags
      const hashtagsStr = (confession.hashtags || []).join(' ');
      const fullCaption = `${confession.caption || ''}\n\n${hashtagsStr}`.trim();

      // 5. Call Instagram Service
      const publishResult = await instagramService.publishPost(confession, imageUrl, fullCaption);

      if (!publishResult.success) {
        const newRetryCount = (confession.retry_count || 0) + 1;
        const nextStatus: ConfessionStatus = newRetryCount >= 3 ? 'FAILED_REQUIRES_ACTION' : 'FAILED';

        await this.updateConfession(id, {
          status: nextStatus,
          retry_count: newRetryCount,
          error_message: publishResult.error || 'Failed to publish post',
        });

        // Update Google Sheet with error
        const sheetConfig = mockStore.getGoogleSheetConfig();
        if (confession.google_sheet_row) {
          await googleSheetsService.updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'FAILED',
            error: publishResult.error || 'Publishing error',
          });
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
      const updated = await this.updateConfession(id, {
        status: 'PUBLISHED',
        published_at: publishedAt,
        instagram_media_id: publishResult.mediaId,
        instagram_permalink: publishResult.permalink,
        error_message: null,
      });

      // 7. Update Google Sheet — status only (permalink stored internally, not in your spreadsheet)
      const sheetConfig = mockStore.getGoogleSheetConfig();
      if (confession.google_sheet_row) {
        try {
          console.log(`[ConfessionService] Marking Google Sheet row #${confession.google_sheet_row} as PUBLISHED...`);
          const sheetOk = await googleSheetsService.updateRowStatus(sheetConfig, confession.google_sheet_row, {
            status: 'PUBLISHED',
            processedAt: publishedAt,
            error: '',
          });
          if (sheetOk) {
            console.log(`[ConfessionService] Successfully marked row #${confession.google_sheet_row} as PUBLISHED on Google Sheet.`);
          } else {
            console.warn(`[ConfessionService] Warning: Could not write PUBLISHED status to row #${confession.google_sheet_row} on Google Sheet.`);
          }
        } catch (sheetErr: any) {
          console.error(`[ConfessionService] Error updating Google Sheet row #${confession.google_sheet_row}:`, sheetErr?.message || sheetErr);
        }
      }

      // 8. Save permalink to internal published posts log (not in Google Sheet)
      mockStore.addPublishedPost({
        confession_id: id,
        confession_number: confession.google_sheet_row ?? 0,
        instagram_media_id: publishResult.mediaId ?? '',
        permalink: publishResult.permalink ?? '',
        published_at: publishedAt,
        template_name: mockStore.getTemplateById(confession.template_id ?? '')?.name,
        preview_text: (confession.cleaned_text || confession.original_text || '').slice(0, 80),
      });

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
      total: all.length,
      pendingReview: all.filter((c) => c.status === 'READY_FOR_REVIEW').length,
      approved: all.filter((c) => c.status === 'APPROVED').length,
      scheduled: all.filter((c) => c.status === 'SCHEDULED').length,
      published: all.filter((c) => c.status === 'PUBLISHED').length,
      rejected: all.filter((c) => c.status === 'REJECTED').length,
      failed: all.filter((c) => c.status === 'FAILED' || c.status === 'FAILED_REQUIRES_ACTION').length,
      publishedToday,
      maxDailyPosts: settings.max_daily_posts || 10,
    };
  }
}

export const confessionService = new ConfessionService();
