import { Confession, ConfessionStatus } from '@/types';
import { mockStore } from '@/lib/mockStore';
import { instagramService } from '@/services/instagramService';
import { googleSheetsService } from '@/services/googleSheetsService';
import {
  generateContentHash,
  normalizeConfessionText,
} from '@/lib/contentHash';

export interface ReconciliationResult {
  totalScanned: number;
  reconciledToPublished: number;
  duplicatesFlagged: number;
  confirmedFailed: number;
  unknownNeedsReview: number;
  details: {
    confessionId: string;
    rowNumber?: number | null;
    previousStatus: ConfessionStatus;
    newStatus: ConfessionStatus;
    reason: string;
    mediaId?: string | null;
    permalink?: string | null;
  }[];
}

export interface DuplicateGroup {
  contentHash: string;
  previewText: string;
  confessions: Confession[];
}

export class ReconciliationService {
  /**
   * Ensure content hashes are populated for all confessions
   */
  public ensureContentHashes(): void {
    const confessions = mockStore.getConfessions();
    let updated = false;

    for (const c of confessions) {
      const text = c.cleaned_text || c.original_text || '';
      const normHash = generateContentHash(text);
      if (c.normalized_content_hash !== normHash || !c.content_hash) {
        c.normalized_content_hash = normHash;
        c.content_hash = normHash;
        updated = true;
      }
    }

    if (updated) {
      mockStore.save();
    }
  }

  /**
   * Reconcile a single confession against internal ledger and Instagram API
   */
  public async reconcileConfession(id: string): Promise<{
    confession: Confession;
    changed: boolean;
    reason: string;
  }> {
    const confession = mockStore.getConfessionById(id);
    if (!confession) {
      throw new Error(`Confession ${id} not found.`);
    }

    const text = confession.cleaned_text || confession.original_text || '';
    const normText = normalizeConfessionText(text);
    const hash = generateContentHash(text);

    confession.normalized_content_hash = hash;
    confession.content_hash = hash;

    const previousStatus = confession.status;
    let changed = false;
    let reason = 'No status change required.';

    // 1. If already PUBLISHED, ensure ledger has it and hashes are filled
    if (confession.status === 'PUBLISHED') {
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = confession.reconciliation_notes || 'Already verified published.';
      mockStore.updateConfession(confession.id, confession);
      return { confession, changed: false, reason: 'Already verified published.' };
    }

    // 2. Check internal publishedPosts ledger
    const publishedLedger = mockStore.getPublishedPosts();
    const ledgerMatch = publishedLedger.find((p) => {
      if (p.confession_id && p.confession_id === confession.id) return true;
      if (confession.google_sheet_row && p.confession_number === confession.google_sheet_row) return true;
      if (p.preview_text && normText && normalizeConfessionText(p.preview_text) === normText) return true;
      return false;
    });

    if (ledgerMatch) {
      confession.status = 'PUBLISHED';
      confession.instagram_media_id = ledgerMatch.instagram_media_id || confession.instagram_media_id || 'reconciled-ledger';
      confession.instagram_permalink = ledgerMatch.permalink || confession.instagram_permalink || `https://www.instagram.com/p/${confession.instagram_media_id}/`;
      confession.published_at = ledgerMatch.published_at || new Date().toISOString();
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = `Reconciled: Found in published posts ledger (Media: ${ledgerMatch.instagram_media_id}).`;
      changed = true;
      reason = confession.reconciliation_notes;

      mockStore.updateConfession(confession.id, confession);
      await this.syncPublishedToSheet(confession);
      return { confession, changed, reason };
    }

    // 3. Check if another confession is already PUBLISHED with same content hash or row
    const allConfessions = mockStore.getConfessions();
    const duplicatePublished = allConfessions.find(
      (c) =>
        c.id !== confession.id &&
        c.status === 'PUBLISHED' &&
        (c.normalized_content_hash === hash || (confession.google_sheet_row && c.google_sheet_row === confession.google_sheet_row))
    );

    if (duplicatePublished) {
      confession.status = 'DUPLICATE_ALREADY_PUBLISHED';
      confession.duplicate_of_id = duplicatePublished.id;
      confession.duplicate_of_row = duplicatePublished.google_sheet_row ?? null;
      confession.duplicate_of_permalink = duplicatePublished.instagram_permalink ?? null;
      confession.instagram_media_id = duplicatePublished.instagram_media_id;
      confession.instagram_permalink = duplicatePublished.instagram_permalink;
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = `Reconciled: Content was already published under confession #${duplicatePublished.google_sheet_row || duplicatePublished.id}.`;
      changed = true;
      reason = confession.reconciliation_notes;

      mockStore.updateConfession(confession.id, confession);
      await this.syncDuplicateToSheet(confession);
      return { confession, changed, reason };
    }

    // 4. Query live Instagram Graph API recent media feed (up to 50 items)
    let recentMedia: any[] = [];
    try {
      recentMedia = await instagramService.getRecentMedia(50);
    } catch (err: any) {
      console.warn('[ReconciliationService] Instagram API unavailable for reconciliation:', err?.message || err);
    }

    if (recentMedia.length > 0) {
      const rowPattern = confession.google_sheet_row ? new RegExp(`#0*${confession.google_sheet_row}\\b`, 'i') : null;

      const mediaMatch = recentMedia.find((m) => {
        const caption = m.caption || '';
        const normCaption = normalizeConfessionText(caption);

        // Check confession number pattern in caption (e.g. #035, #35)
        if (rowPattern && rowPattern.test(caption)) {
          return true;
        }

        // Check if normalized confession text is inside caption
        if (normText && normText.length > 15 && normCaption.includes(normText)) {
          return true;
        }

        return false;
      });

      if (mediaMatch) {
        confession.status = 'PUBLISHED';
        confession.instagram_media_id = mediaMatch.id;
        confession.instagram_permalink = mediaMatch.permalink || `https://www.instagram.com/p/${mediaMatch.id}/`;
        confession.published_at = mediaMatch.timestamp || new Date().toISOString();
        confession.reconciliation_status = 'RECONCILED';
        confession.reconciliation_notes = `Reconciled: Found live on Instagram (Media: ${mediaMatch.id}).`;
        changed = true;
        reason = confession.reconciliation_notes;

        // Register into published posts ledger
        mockStore.addPublishedPost({
          confession_id: confession.id,
          confession_number: confession.google_sheet_row ?? 0,
          instagram_media_id: mediaMatch.id,
          permalink: confession.instagram_permalink || '',
          published_at: confession.published_at || new Date().toISOString(),
          template_name: mockStore.getTemplateById(confession.template_id ?? '')?.name,
          preview_text: (confession.cleaned_text || confession.original_text || '').slice(0, 80),
        });

        mockStore.updateConfession(confession.id, confession);
        await this.syncPublishedToSheet(confession);
        return { confession, changed, reason };
      }
    }

    // 5. If status was UNKNOWN or stuck PUBLISHING and not found on Instagram:
    if (previousStatus === 'UNKNOWN' || previousStatus === 'PUBLISHING') {
      confession.status = 'UNKNOWN_NEEDS_REVIEW';
      confession.reconciliation_status = 'MANUAL_REVIEW_REQUIRED';
      confession.reconciliation_notes = 'Publication status could not be verified on Instagram. Requires manual review.';
      changed = true;
      reason = confession.reconciliation_notes;
      mockStore.updateConfession(confession.id, confession);
      return { confession, changed, reason };
    }

    // 6. If status was FAILED / FAILED_REQUIRES_ACTION:
    if (previousStatus === 'FAILED' || previousStatus === 'FAILED_REQUIRES_ACTION') {
      confession.status = 'FAILED_CONFIRMED';
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = 'Confirmed not published on Instagram. Safe to retry after fixing root issue.';
      changed = true;
      reason = confession.reconciliation_notes;
      mockStore.updateConfession(confession.id, confession);
      return { confession, changed, reason };
    }

    return { confession, changed, reason };
  }

  /**
   * Batch reconcile all historical confessions that are FAILED, UNKNOWN, or PUBLISHING
   */
  public async reconcileHistoricalPublishingState(): Promise<ReconciliationResult> {
    this.ensureContentHashes();

    const allConfessions = mockStore.getConfessions();
    const candidates = allConfessions.filter(
      (c) =>
        c.status === 'FAILED' ||
        c.status === 'FAILED_REQUIRES_ACTION' ||
        c.status === 'FAILED_CONFIRMED' ||
        c.status === 'UNKNOWN' ||
        c.status === 'UNKNOWN_NEEDS_REVIEW' ||
        c.status === 'PUBLISHING' ||
        (c.status !== 'PUBLISHED' && c.instagram_media_id)
    );

    const result: ReconciliationResult = {
      totalScanned: candidates.length,
      reconciledToPublished: 0,
      duplicatesFlagged: 0,
      confirmedFailed: 0,
      unknownNeedsReview: 0,
      details: [],
    };

    for (const candidate of candidates) {
      const prevStatus = candidate.status;
      const { confession, changed, reason } = await this.reconcileConfession(candidate.id);

      if (confession.status === 'PUBLISHED') {
        result.reconciledToPublished++;
      } else if (confession.status === 'DUPLICATE_ALREADY_PUBLISHED') {
        result.duplicatesFlagged++;
      } else if (confession.status === 'FAILED_CONFIRMED') {
        result.confirmedFailed++;
      } else if (confession.status === 'UNKNOWN_NEEDS_REVIEW' || confession.status === 'UNKNOWN') {
        result.unknownNeedsReview++;
      }

      result.details.push({
        confessionId: candidate.id,
        rowNumber: candidate.google_sheet_row,
        previousStatus: prevStatus,
        newStatus: confession.status,
        reason,
        mediaId: confession.instagram_media_id,
        permalink: confession.instagram_permalink,
      });
    }

    mockStore.addLog({
      action: 'RECONCILIATION_COMPLETED',
      entity_type: 'system',
      metadata: {
        totalScanned: result.totalScanned,
        reconciledToPublished: result.reconciledToPublished,
        duplicatesFlagged: result.duplicatesFlagged,
        confirmedFailed: result.confirmedFailed,
        unknownNeedsReview: result.unknownNeedsReview,
      },
    });

    return result;
  }

  /**
   * Find groups of duplicate candidates based on normalized content hash
   */
  public getDuplicateCandidates(): DuplicateGroup[] {
    this.ensureContentHashes();
    const all = mockStore.getConfessions().filter((c) => c.status !== 'DELETED');
    const groupsByHash = new Map<string, Confession[]>();

    for (const c of all) {
      const hash = c.normalized_content_hash || generateContentHash(c.cleaned_text || c.original_text);
      if (!groupsByHash.has(hash)) {
        groupsByHash.set(hash, []);
      }
      groupsByHash.get(hash)!.push(c);
    }

    const duplicates: DuplicateGroup[] = [];
    for (const [hash, items] of groupsByHash.entries()) {
      if (items.length > 1) {
        duplicates.push({
          contentHash: hash,
          previewText: items[0].cleaned_text || items[0].original_text || '',
          confessions: items,
        });
      }
    }

    return duplicates;
  }

  /**
   * Resolve a duplicate candidate
   */
  public async resolveDuplicateCandidate(
    id: string,
    resolution: 'MARK_DUPLICATE' | 'ALLOW_POST' | 'CANCEL'
  ): Promise<Confession> {
    const confession = mockStore.getConfessionById(id);
    if (!confession) {
      throw new Error(`Confession ${id} not found.`);
    }

    if (resolution === 'MARK_DUPLICATE') {
      confession.status = 'DUPLICATE_ALREADY_PUBLISHED';
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = 'Marked as duplicate by administrator.';
      await this.syncDuplicateToSheet(confession);
    } else if (resolution === 'ALLOW_POST') {
      confession.status = 'APPROVED';
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = 'Approved for publication override by administrator.';
    } else if (resolution === 'CANCEL') {
      confession.status = 'CANCELLED';
      confession.reconciliation_status = 'RECONCILED';
      confession.reconciliation_notes = 'Publication cancelled by administrator.';
    }

    mockStore.updateConfession(confession.id, confession);
    return confession;
  }

  private async syncPublishedToSheet(confession: Confession): Promise<void> {
    if (!confession.google_sheet_row) return;
    try {
      const config = mockStore.getGoogleSheetConfig();
      await googleSheetsService.updateRowStatus(config, confession.google_sheet_row, {
        status: 'PUBLISHED',
        processedAt: confession.published_at || new Date().toISOString(),
        postId: confession.instagram_media_id || '',
        instagramUrl: confession.instagram_permalink || '',
        error: '',
      });
    } catch (err: any) {
      console.warn(`[ReconciliationService] Warning: Could not update sheet row #${confession.google_sheet_row}:`, err?.message || err);
    }
  }

  private async syncDuplicateToSheet(confession: Confession): Promise<void> {
    if (!confession.google_sheet_row) return;
    try {
      const config = mockStore.getGoogleSheetConfig();
      await googleSheetsService.updateRowStatus(config, confession.google_sheet_row, {
        status: 'DUPLICATE',
        processedAt: new Date().toISOString(),
        postId: confession.instagram_media_id || '',
        instagramUrl: confession.instagram_permalink || '',
        error: confession.reconciliation_notes || 'Duplicate of already published post.',
      });
    } catch (err: any) {
      console.warn(`[ReconciliationService] Warning: Could not update sheet row #${confession.google_sheet_row}:`, err?.message || err);
    }
  }
}

export const reconciliationService = new ReconciliationService();
