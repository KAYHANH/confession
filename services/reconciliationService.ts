/**
 * ConfessionFlow - Publication Reconciliation Service
 * The SINGLE CANONICAL AUTHORITY for publication state verification & duplicate protection.
 *
 * Reconciles suspicious, historical, and unconfirmed publishing records against:
 * 1. Internal Confessions Database (authoritative published records)
 * 2. Published Posts Ledger (verified historical publications)
 * 3. Exact & Semantic Content Deduplication (linked to already published posts)
 * 4. Pre-Publication Rejection Signals (confirmed never reached Meta)
 * 5. Live Instagram Graph API Feed Inspection (with explicit network error vs empty feed separation)
 *
 * Invariants:
 * - publishing_status and reconciliation_status are strictly separate fields.
 * - UNKNOWN is NEVER equated with FAILED or NOT_PUBLISHED.
 * - DUPLICATE is ONLY assigned when backed by evidence linking to an already published confession.
 * - Safe retry is strictly restricted to CONFIRMED_NOT_PUBLISHED records.
 * - Totals in reconciliation reports strictly sum to 100% of examined records without overlap.
 */

import {
  Confession,
  ConfessionStatus,
  ReconciliationStatus,
  ReconciliationEvidence,
  ReconciliationCheckMethod,
} from '@/types';
import { mockStore } from '@/lib/mockStore';
import { instagramService, InstagramFeedFetchResult } from '@/services/instagramService';
import { googleSheetsService } from '@/services/googleSheetsService';
import {
  generateContentHash,
  generateRawContentHash,
  normalizeConfessionText,
} from '@/lib/contentHash';
import { duplicateQualityService } from '@/services/quality/duplicateQualityService';

export interface PublicationMatch {
  isPublished: boolean;
  mediaId: string | null;
  permalink: string | null;
  publishedAt: string | null;
  source: 'database' | 'ledger' | 'instagram_api';
  checkMethod: ReconciliationCheckMethod;
  evidence: string;
  matchedRecordId?: string;
  matchedRow?: number | null;
}

export interface DuplicateMatch {
  isDuplicate: boolean;
  duplicateOfId: string;
  duplicateOfRow: number | null;
  duplicateOfPermalink: string | null;
  duplicateOfMediaId: string | null;
  matchType: 'EXACT_HASH' | 'EXACT_TEXT' | 'NEAR_DUPLICATE' | 'ROW_LINKAGE';
  similarity: number;
  evidence: string;
}

export interface ReconciliationClassification {
  status: ReconciliationStatus;
  checkMethod: ReconciliationCheckMethod | string;
  confidence: number;
  evidence: string;
  mediaId?: string | null;
  permalink?: string | null;
  duplicateOfId?: string | null;
  duplicateOfRow?: number | null;
  duplicateOfPermalink?: string | null;
}

export interface ReconciliationRecordResult {
  confessionId: string;
  rowNumber?: number | null;
  previousStatus: ConfessionStatus;
  newStatus: ConfessionStatus;
  previousReconciliationStatus?: ReconciliationStatus | null;
  newReconciliationStatus: ReconciliationStatus;
  classification: ReconciliationClassification;
  changed: boolean;
  reason: string;
  evidence: ReconciliationEvidence;
}

export interface ReconciliationReport {
  total: number;
  alreadyPublished: number;
  confirmedNotPublished: number;
  duplicates: number;
  unknown: number;
  manualReview: number;
  safeToRetry: number;
  reconciledToPublished: number;
  duplicatesFlagged: number;
  confirmedFailed: number;
  unknownNeedsReview: number;
  items: ReconciliationRecordResult[];
  completedAt: string;
}

export interface FinalPublicationCheckResult {
  canPublish: boolean;
  status: ReconciliationStatus;
  reason: string;
  evidence?: ReconciliationEvidence;
}

export interface DuplicateGroup {
  contentHash: string;
  previewText: string;
  confessions: Confession[];
}

export class PublicationReconciliationService {
  private isReconciliationRunning = false;
  private currentProgress = { current: 0, total: 0, isRunning: false };

  public isRunning(): boolean {
    return this.isReconciliationRunning;
  }

  public getProgress(): { current: number; total: number; isRunning: boolean } {
    return { ...this.currentProgress, isRunning: this.isReconciliationRunning };
  }

  // ---------------------------------------------------------------------------
  // 1. Content Hash Management & Normalization
  // ---------------------------------------------------------------------------

  /**
   * Ensures raw and normalized content hashes are populated for all confessions
   */
  public ensureContentHashes(): void {
    const confessions = mockStore.getConfessions();
    let updated = false;

    for (const c of confessions) {
      const text = c.cleaned_text || c.original_text || '';
      const normHash = generateContentHash(text);
      const rawHash = generateRawContentHash(text);

      if (c.normalized_content_hash !== normHash || c.raw_content_hash !== rawHash || !c.content_hash) {
        c.normalized_content_hash = normHash;
        c.raw_content_hash = rawHash;
        c.content_hash = normHash;
        updated = true;
      }
    }

    if (updated) {
      mockStore.save();
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Publication Detection & Match Finders
  // ---------------------------------------------------------------------------

  /**
   * Searches internal database records, published ledger, and live Instagram feed
   * to determine if an authoritative publication exists for the candidate confession.
   */
  public async findExistingPublication(
    record: Confession,
    options?: { forceLiveInstagram?: boolean; liveMediaFeed?: any[] }
  ): Promise<PublicationMatch | null> {
    const text = record.cleaned_text || record.original_text || '';
    const normText = normalizeConfessionText(text);
    const normHash = record.normalized_content_hash || generateContentHash(text);

    // 1. Check if record itself already has confirmed media_id and status is PUBLISHED
    if (record.status === 'PUBLISHED' && record.instagram_media_id) {
      return {
        isPublished: true,
        mediaId: record.instagram_media_id,
        permalink: record.instagram_permalink || `https://www.instagram.com/p/${record.instagram_media_id}/`,
        publishedAt: record.published_at || record.updated_at || new Date().toISOString(),
        source: 'database',
        checkMethod: 'authoritative_db_published',
        evidence: `Confession #${record.google_sheet_row || record.id} is authoritatively recorded as PUBLISHED with Instagram media ID ${record.instagram_media_id}.`,
        matchedRecordId: record.id,
        matchedRow: record.google_sheet_row,
      };
    }

    // 2. Check if another confession with identical Google Sheet row is already PUBLISHED
    const allConfessions = mockStore.getConfessions();
    if (record.google_sheet_row) {
      const rowMatch = allConfessions.find(
        (c) =>
          c.id !== record.id &&
          c.google_sheet_row === record.google_sheet_row &&
          c.status === 'PUBLISHED' &&
          c.instagram_media_id
      );
      if (rowMatch) {
        return {
          isPublished: true,
          mediaId: rowMatch.instagram_media_id,
          permalink: rowMatch.instagram_permalink,
          publishedAt: rowMatch.published_at,
          source: 'database',
          checkMethod: 'authoritative_db_published',
          evidence: `Google Sheet row #${record.google_sheet_row} was already published under confession record ${rowMatch.id} (Media ID: ${rowMatch.instagram_media_id}).`,
          matchedRecordId: rowMatch.id,
          matchedRow: rowMatch.google_sheet_row,
        };
      }
    }

    // 3. Check published posts ledger
    const publishedLedger = mockStore.getPublishedPosts();
    const ledgerMatch = publishedLedger.find((p) => {
      if (p.confession_id && p.confession_id === record.id) return true;
      if (record.google_sheet_row && p.confession_number === record.google_sheet_row) return true;
      if (p.preview_text && normText && normalizeConfessionText(p.preview_text) === normText) return true;
      if (record.instagram_media_id && p.instagram_media_id === record.instagram_media_id) return true;
      return false;
    });

    if (ledgerMatch) {
      return {
        isPublished: true,
        mediaId: ledgerMatch.instagram_media_id || 'reconciled-ledger',
        permalink: ledgerMatch.permalink || `https://www.instagram.com/p/${ledgerMatch.instagram_media_id}/`,
        publishedAt: ledgerMatch.published_at || new Date().toISOString(),
        source: 'ledger',
        checkMethod: 'published_posts_ledger',
        evidence: `Found verified match in published posts ledger (Media ID: ${ledgerMatch.instagram_media_id}, Confession #${ledgerMatch.confession_number}).`,
        matchedRecordId: ledgerMatch.confession_id,
        matchedRow: ledgerMatch.confession_number,
      };
    }

    // 4. Live Instagram feed check (if requested, passed in, or available via getRecentMedia)
    let mediaFeed = options?.liveMediaFeed;
    if (!mediaFeed) {
      try {
        const directMedia = await instagramService.getRecentMedia(50);
        if (Array.isArray(directMedia) && directMedia.length > 0) {
          mediaFeed = directMedia;
        }
      } catch {}
    }
    if (Array.isArray(mediaFeed) && mediaFeed.length > 0) {
      const rowPattern = record.google_sheet_row ? new RegExp(`#0*${record.google_sheet_row}\\b`, 'i') : null;
      const mediaMatch = mediaFeed.find((m) => {
        // Direct media ID match
        if (record.instagram_media_id && m.id === record.instagram_media_id) return true;
        const caption = m.caption || '';
        // Pattern match on confession number in caption (e.g. #035, #35)
        if (rowPattern && rowPattern.test(caption)) return true;
        // Text inclusion in caption for confessions with enough substance
        const normCaption = normalizeConfessionText(caption);
        if (normText.length > 20 && normCaption.includes(normText)) return true;
        return false;
      });

      if (mediaMatch) {
        return {
          isPublished: true,
          mediaId: mediaMatch.id,
          permalink: mediaMatch.permalink || `https://www.instagram.com/p/${mediaMatch.id}/`,
          publishedAt: mediaMatch.timestamp || new Date().toISOString(),
          source: 'instagram_api',
          checkMethod: 'instagram_api_feed_match',
          evidence: `Confirmed live on Instagram feed (Media ID: ${mediaMatch.id}, Caption snippet: "${(mediaMatch.caption || '').slice(0, 50)}...").`,
          matchedRecordId: record.id,
          matchedRow: record.google_sheet_row,
        };
      }
    }

    return null;
  }

  /**
   * Searches for duplicate linkage strictly against ALREADY PUBLISHED confessions.
   * Per Section 8 & 22: Unrelated unconfirmed/pending items must NEVER be called duplicates.
   */
  public findPublishedDuplicateMatch(record: Confession): DuplicateMatch | null {
    const text = record.cleaned_text || record.original_text || '';
    const normText = normalizeConfessionText(text);
    const normHash = record.normalized_content_hash || generateContentHash(text);
    if (!normText) return null;

    const allConfessions = mockStore.getConfessions();
    const publishedPool = allConfessions.filter(
      (c) => c.id !== record.id && c.status === 'PUBLISHED' && c.instagram_media_id
    );

    for (const pub of publishedPool) {
      const pubText = pub.cleaned_text || pub.original_text || '';
      const pubNormText = normalizeConfessionText(pubText);
      const pubHash = pub.normalized_content_hash || generateContentHash(pubText);

      // 1. Exact normalized hash match
      if (normHash && pubHash && normHash === pubHash) {
        return {
          isDuplicate: true,
          duplicateOfId: pub.id,
          duplicateOfRow: pub.google_sheet_row ?? null,
          duplicateOfPermalink: pub.instagram_permalink ?? null,
          duplicateOfMediaId: pub.instagram_media_id ?? null,
          matchType: 'EXACT_HASH',
          similarity: 1.0,
          evidence: `Exact content hash match with published confession #${pub.google_sheet_row || pub.id} (Hash: ${normHash.slice(0, 12)}...).`,
        };
      }

      // 2. Exact normalized text match (ignoring whitespace, formatting, HTML entities)
      if (normText === pubNormText) {
        return {
          isDuplicate: true,
          duplicateOfId: pub.id,
          duplicateOfRow: pub.google_sheet_row ?? null,
          duplicateOfPermalink: pub.instagram_permalink ?? null,
          duplicateOfMediaId: pub.instagram_media_id ?? null,
          matchType: 'EXACT_TEXT',
          similarity: 1.0,
          evidence: `Exact normalized text match with published confession #${pub.google_sheet_row || pub.id}.`,
        };
      }

      // 3. Near duplicate via word-level Jaccard similarity (>= 0.88 for texts with 5+ words)
      const words = normText.split(' ').filter(Boolean);
      if (words.length >= 5) {
        const similarity = duplicateQualityService.calculateJaccardSimilarity(text, pubText);
        if (similarity >= 0.88) {
          return {
            isDuplicate: true,
            duplicateOfId: pub.id,
            duplicateOfRow: pub.google_sheet_row ?? null,
            duplicateOfPermalink: pub.instagram_permalink ?? null,
            duplicateOfMediaId: pub.instagram_media_id ?? null,
            matchType: 'NEAR_DUPLICATE',
            similarity: Math.round(similarity * 100) / 100,
            evidence: `High text similarity (${Math.round(similarity * 100)}%) with published confession #${pub.google_sheet_row || pub.id}.`,
          };
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // 3. Authoritative Decision Tree Classification
  // ---------------------------------------------------------------------------

  /**
   * Evaluates candidate record against the 5-step Decision Tree:
   * STEP 1: Does an authoritative published record exist in DB? -> ALREADY_PUBLISHED
   * STEP 2: Does a matching media ID / permalink exist? -> ALREADY_PUBLISHED
   * STEP 3: Does a duplicate match exist against an already published confession? -> DUPLICATE
   * STEP 4: Was the previous publish attempt confirmed rejected before publication? -> CONFIRMED_NOT_PUBLISHED
   * STEP 5: Can Instagram state be confidently checked?
   *         - Found on IG -> ALREADY_PUBLISHED
   *         - Clean check, not on IG -> CONFIRMED_NOT_PUBLISHED
   *         - Error / Timeout / Rate Limit -> UNKNOWN (or MANUAL_REVIEW if attempts >= 3)
   */
  public classifyPublicationState(
    record: Confession,
    pubMatch: PublicationMatch | null,
    duplicateMatch: DuplicateMatch | null,
    igFeedResult?: InstagramFeedFetchResult
  ): ReconciliationClassification {
    // STEP 1 & 2: Authoritative Publication Match
    if (pubMatch && pubMatch.isPublished) {
      return {
        status: 'ALREADY_PUBLISHED',
        checkMethod: pubMatch.checkMethod,
        confidence: 1.0,
        evidence: pubMatch.evidence,
        mediaId: pubMatch.mediaId,
        permalink: pubMatch.permalink,
      };
    }

    // STEP 3: Duplicate of an Already Published Confession
    if (duplicateMatch && duplicateMatch.isDuplicate) {
      return {
        status: 'DUPLICATE',
        checkMethod: 'published_content_duplicate',
        confidence: duplicateMatch.similarity,
        evidence: duplicateMatch.evidence,
        duplicateOfId: duplicateMatch.duplicateOfId,
        duplicateOfRow: duplicateMatch.duplicateOfRow,
        duplicateOfPermalink: duplicateMatch.duplicateOfPermalink,
      };
    }

    // STEP 4: Confirmed Pre-Publication Rejection
    // If the failure reason proves the request was aborted BEFORE any Instagram publication:
    const err = (record.error_message || '').toLowerCase();
    const isPrePublishError =
      err.includes('does not safely fit on one card') ||
      err.includes('too long for one instagram carousel') ||
      err.includes('pre-publication validation failed') ||
      err.includes('cannot publish a rejected confession') ||
      err.includes('safety moderation risk') ||
      err.includes('blocked by quality gate') ||
      err.includes('template not found') ||
      err.includes('canvas') ||
      err.includes('rendering error') ||
      err.includes('invalid media format') ||
      err.includes('credentials are not configured');

    if (isPrePublishError && !record.instagram_media_id) {
      return {
        status: 'CONFIRMED_NOT_PUBLISHED',
        checkMethod: 'pre_publish_rejection_error',
        confidence: 1.0,
        evidence: `Publish attempt failed deterministically before external network transmission: "${record.error_message}".`,
      };
    }

    // STEP 5: Live Instagram Feed State Verification
    if (igFeedResult) {
      if (igFeedResult.success) {
        // Feed fetched cleanly and post was NOT found in the recent media feed
        return {
          status: 'CONFIRMED_NOT_PUBLISHED',
          checkMethod: 'instagram_api_feed_not_found',
          confidence: 0.95,
          evidence: `Queried live Instagram feed (${igFeedResult.media.length} recent media items inspected). No matching media or caption found.`,
        };
      }

      // API returned error: Network drop, Timeout, Rate limit, Auth error
      const attempts = (record.reconciliation_attempts || 0) + 1;
      const isExceededAttempts = attempts >= 3;

      if (isExceededAttempts) {
        return {
          status: 'MANUAL_REVIEW',
          checkMethod: 'exceeded_attempts_manual_review',
          confidence: 0.5,
          evidence: `Instagram API returned ${igFeedResult.errorType || 'ERROR'} (${igFeedResult.errorMessage || 'unknown'}). Exceeded maximum automated reconciliation attempts (${attempts}/3). Flagged for administrator review.`,
        };
      }

      const checkMethod =
        igFeedResult.errorType === 'TIMEOUT'
          ? 'instagram_api_timeout'
          : igFeedResult.errorType === 'RATE_LIMIT'
          ? 'instagram_api_rate_limit'
          : 'instagram_api_network_error';

      return {
        status: 'UNKNOWN',
        checkMethod,
        confidence: 0,
        evidence: `Instagram API was unreachable or timed out (${igFeedResult.errorType}: ${igFeedResult.errorMessage}). Publication state remains unconfirmed.`,
      };
    }

    // Default fallback when live check not performed
    const attempts = (record.reconciliation_attempts || 0) + 1;
    if (attempts >= 3) {
      return {
        status: 'MANUAL_REVIEW',
        checkMethod: 'exceeded_attempts_manual_review',
        confidence: 0.5,
        evidence: `Record has had ${attempts} reconciliation attempts without verified publication evidence. Requires human inspection.`,
      };
    }

    return {
      status: 'UNKNOWN',
      checkMethod: 'unverified_state',
      confidence: 0,
      evidence: 'No conclusive publication or pre-publish rejection evidence available. Requires Instagram API verification.',
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Single Record Reconciliation: reconcileRecord
  // ---------------------------------------------------------------------------

  /**
   * Reconciles a single confession record and writes precise machine-readable evidence.
   */
  public async reconcileRecord(
    id: string,
    options?: { forceLiveInstagram?: boolean; liveMediaFeed?: any[]; liveFeedResult?: InstagramFeedFetchResult }
  ): Promise<ReconciliationRecordResult> {
    const confession = mockStore.getConfessionById(id);
    if (!confession) {
      throw new Error(`Confession with ID ${id} not found.`);
    }

    const previousStatus = confession.status;
    const previousReconStatus = confession.reconciliation_status || null;
    const nowIso = new Date().toISOString();

    // Ensure content hashes exist on candidate
    const text = confession.cleaned_text || confession.original_text || '';
    confession.normalized_content_hash = generateContentHash(text);
    confession.raw_content_hash = generateRawContentHash(text);
    confession.content_hash = confession.normalized_content_hash;

    // 1. Fetch live Instagram feed if needed and not already supplied
    let igFeedResult = options?.liveFeedResult;
    let liveMedia = options?.liveMediaFeed;

    if (!igFeedResult && options?.forceLiveInstagram) {
      igFeedResult = await instagramService.fetchRecentMediaWithStatus(50);
      liveMedia = igFeedResult.media;
    }

    // 2. Run Matchers
    const pubMatch = await this.findExistingPublication(confession, {
      liveMediaFeed: liveMedia,
    });
    const duplicateMatch = !pubMatch ? this.findPublishedDuplicateMatch(confession) : null;

    // 3. Classify using Decision Tree
    const classification = this.classifyPublicationState(confession, pubMatch, duplicateMatch, igFeedResult);

    const attempts = (confession.reconciliation_attempts || 0) + 1;
    const evidence: ReconciliationEvidence = {
      record_id: confession.id,
      checked_at: nowIso,
      source: pubMatch ? pubMatch.source : duplicateMatch ? 'content_matcher' : igFeedResult?.success ? 'instagram_api' : 'database',
      check_method: classification.checkMethod,
      result: classification.status,
      confidence: classification.confidence,
      evidence: classification.evidence,
      instagram_media_id: classification.mediaId || confession.instagram_media_id || null,
      instagram_permalink: classification.permalink || confession.instagram_permalink || null,
      duplicate_of_id: classification.duplicateOfId || null,
      duplicate_of_row: classification.duplicateOfRow || null,
      duplicate_of_permalink: classification.duplicateOfPermalink || null,
    };

    let newStatus = confession.status;
    let newReconStatus: ReconciliationStatus = classification.status;

    // Apply strict status mapping based on decision
    if (classification.status === 'ALREADY_PUBLISHED') {
      newStatus = 'PUBLISHED';
      newReconStatus = 'ALREADY_PUBLISHED';
      confession.instagram_media_id = classification.mediaId || confession.instagram_media_id || 'reconciled-ig';
      confession.instagram_permalink = classification.permalink || confession.instagram_permalink || `https://www.instagram.com/p/${confession.instagram_media_id}/`;
      confession.published_at = confession.published_at || nowIso;

      // Register into published posts ledger if missing
      mockStore.addPublishedPost({
        confession_id: confession.id,
        confession_number: confession.google_sheet_row ?? 0,
        instagram_media_id: confession.instagram_media_id,
        permalink: confession.instagram_permalink,
        published_at: confession.published_at,
        preview_text: text.slice(0, 80),
      });

      // Synchronize with Google Sheets
      await this.syncPublishedToSheet(confession);
    } else if (classification.status === 'DUPLICATE') {
      newStatus = 'DUPLICATE_ALREADY_PUBLISHED';
      newReconStatus = 'DUPLICATE';
      confession.duplicate_of_id = classification.duplicateOfId || null;
      confession.duplicate_of_row = classification.duplicateOfRow || null;
      confession.duplicate_of_permalink = classification.duplicateOfPermalink || null;

      await this.syncDuplicateToSheet(confession, classification.evidence);
    } else if (classification.status === 'CONFIRMED_NOT_PUBLISHED') {
      // If candidate was previously APPROVED and never actually published, it can safely remain APPROVED
      // If it was previously FAILED, mark FAILED_CONFIRMED (safe to retry)
      newStatus = confession.status === 'APPROVED' ? 'APPROVED' : 'FAILED_CONFIRMED';
      newReconStatus = 'CONFIRMED_NOT_PUBLISHED';
    } else if (classification.status === 'UNKNOWN') {
      newStatus = 'UNKNOWN';
      newReconStatus = 'UNKNOWN';
    } else if (classification.status === 'MANUAL_REVIEW') {
      newStatus = 'UNKNOWN_NEEDS_REVIEW';
      newReconStatus = 'MANUAL_REVIEW';
    }

    const changed = previousStatus !== newStatus || previousReconStatus !== newReconStatus;

    confession.status = newStatus;
    confession.reconciliation_status = newReconStatus;
    confession.reconciliation_reason = classification.evidence;
    confession.reconciliation_notes = classification.evidence;
    confession.reconciliation_evidence = evidence;
    confession.last_reconciled_at = nowIso;
    confession.reconciliation_attempts = attempts;

    mockStore.updateConfession(confession.id, confession);

    return {
      confessionId: confession.id,
      rowNumber: confession.google_sheet_row,
      previousStatus,
      newStatus,
      previousReconciliationStatus: previousReconStatus,
      newReconciliationStatus: newReconStatus,
      classification,
      changed,
      reason: classification.evidence,
      evidence,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Batch Reconciliation Job: reconcileBatch
  // ---------------------------------------------------------------------------

  /**
   * Authoritative batch reconciliation against historical unconfirmed records.
   * SAFETY: Auto-publish is strictly blocked while reconciliation runs!
   * Guarantees exact mutually exclusive breakdown:
   * total = alreadyPublished + confirmedNotPublished + duplicates + unknown + manualReview
   */
  public async reconcileBatch(options?: {
    ids?: string[];
    forceLiveInstagram?: boolean;
    onProgress?: (current: number, total: number) => void;
  }): Promise<ReconciliationReport> {
    this.isReconciliationRunning = true;
    this.ensureContentHashes();

    try {
      const allConfessions = mockStore.getConfessions();
      let candidates: Confession[];

      if (options?.ids && options.ids.length > 0) {
        const idSet = new Set(options.ids);
        candidates = allConfessions.filter((c) => idSet.has(c.id));
      } else {
        // Scan all historical records that are uncertain or unconfirmed
        candidates = allConfessions.filter(
          (c) =>
            c.status === 'FAILED' ||
            c.status === 'FAILED_CONFIRMED' ||
            c.status === 'FAILED_REQUIRES_ACTION' ||
            c.status === 'UNKNOWN' ||
            c.status === 'UNKNOWN_NEEDS_REVIEW' ||
            c.status === 'PUBLISHING' ||
            c.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
            c.reconciliation_status === 'NOT_CHECKED' ||
            c.reconciliation_status === 'CHECKING' ||
            c.reconciliation_status === 'UNKNOWN' ||
            c.reconciliation_status === 'MANUAL_REVIEW' ||
            (c.status !== 'PUBLISHED' && c.instagram_media_id)
        );
      }

      // 1. Fetch live Instagram recent media once for the batch to save quota & avoid rate limits
      let igFeedResult: InstagramFeedFetchResult | undefined;
      try {
        igFeedResult = await instagramService.fetchRecentMediaWithStatus(50);
      } catch (err: any) {
        igFeedResult = {
          success: false,
          media: [],
          errorType: 'NETWORK_ERROR',
          errorMessage: err?.message || 'Failed to fetch Instagram recent media feed',
        };
      }

      this.currentProgress = { current: 0, total: candidates.length, isRunning: true };

      const report: ReconciliationReport = {
        total: candidates.length,
        alreadyPublished: 0,
        confirmedNotPublished: 0,
        duplicates: 0,
        unknown: 0,
        manualReview: 0,
        safeToRetry: 0,
        reconciledToPublished: 0,
        duplicatesFlagged: 0,
        confirmedFailed: 0,
        unknownNeedsReview: 0,
        items: [],
        completedAt: new Date().toISOString(),
      };

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (options?.onProgress) {
          options.onProgress(i + 1, candidates.length);
        }
        this.currentProgress.current = i + 1;

        const res = await this.reconcileRecord(candidate.id, {
          liveFeedResult: igFeedResult,
          liveMediaFeed: igFeedResult?.media,
        });

        report.items.push(res);

        // Mutually exclusive bucket incrementation
        switch (res.newReconciliationStatus) {
          case 'ALREADY_PUBLISHED':
          case 'VERIFIED':
            report.alreadyPublished++;
            break;
          case 'DUPLICATE':
            report.duplicates++;
            break;
          case 'CONFIRMED_NOT_PUBLISHED':
            report.confirmedNotPublished++;
            if (res.newStatus === 'APPROVED' || res.newStatus === 'FAILED_CONFIRMED') {
              report.safeToRetry++;
            }
            break;
          case 'MANUAL_REVIEW':
            report.manualReview++;
            break;
          case 'UNKNOWN':
          default:
            report.unknown++;
            break;
        }
      }

      report.reconciledToPublished = report.alreadyPublished;
      report.duplicatesFlagged = report.duplicates;
      report.confirmedFailed = report.confirmedNotPublished;
      report.unknownNeedsReview = report.unknown + report.manualReview;
      report.completedAt = new Date().toISOString();

      mockStore.addLog({
        action: 'RECONCILIATION_COMPLETED',
        entity_type: 'system',
        metadata: {
          total: report.total,
          alreadyPublished: report.alreadyPublished,
          confirmedNotPublished: report.confirmedNotPublished,
          duplicates: report.duplicates,
          unknown: report.unknown,
          manualReview: report.manualReview,
          safeToRetry: report.safeToRetry,
        },
      });

      return report;
    } finally {
      this.isReconciliationRunning = false;
      this.currentProgress = { current: 0, total: 0, isRunning: false };
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Final Idempotency Check Before Instagram Request (Section 26)
  // ---------------------------------------------------------------------------

  /**
   * Executed IMMEDIATELY before sending any publication payload to Meta.
   * If ALREADY_PUBLISHED, DUPLICATE, UNKNOWN, or MANUAL_REVIEW -> returns canPublish: false.
   * Strictly prevents any double-publishing race condition.
   */
  public async finalPublicationCheck(record: Confession): Promise<FinalPublicationCheckResult> {
    const text = record.cleaned_text || record.original_text || '';
    const normText = normalizeConfessionText(text);
    const normHash = generateContentHash(text);

    // 1. Check if record itself is already PUBLISHED
    if (record.status === 'PUBLISHED' || record.instagram_media_id) {
      return {
        canPublish: false,
        status: 'ALREADY_PUBLISHED',
        reason: `Record is already marked as PUBLISHED with media ID ${record.instagram_media_id}. Aborting duplicate publish.`,
      };
    }

    // 2. Check if another record was published while in queue
    const allConfessions = mockStore.getConfessions();
    const duplicatePublished = allConfessions.find(
      (c) =>
        c.id !== record.id &&
        c.status === 'PUBLISHED' &&
        (c.normalized_content_hash === normHash ||
          (record.google_sheet_row && c.google_sheet_row === record.google_sheet_row))
    );

    if (duplicatePublished) {
      await this.reconcileRecord(record.id);
      return {
        canPublish: false,
        status: 'DUPLICATE',
        reason: `Content was published under confession #${duplicatePublished.google_sheet_row || duplicatePublished.id}. Quarantined as duplicate.`,
      };
    }

    // 3. Check published posts ledger
    const publishedLedger = mockStore.getPublishedPosts();
    const ledgerMatch = publishedLedger.find((p) => {
      if (p.confession_id === record.id) return true;
      if (record.google_sheet_row && p.confession_number === record.google_sheet_row) return true;
      if (p.preview_text && normText && normalizeConfessionText(p.preview_text) === normText) return true;
      return false;
    });

    if (ledgerMatch) {
      await this.markPublished(record.id, ledgerMatch.instagram_media_id, ledgerMatch.permalink || '');
      return {
        canPublish: false,
        status: 'ALREADY_PUBLISHED',
        reason: `Matched verified publication in ledger (Media ID: ${ledgerMatch.instagram_media_id}).`,
      };
    }

    // 4. Check if current status is un-reconciled UNKNOWN or MANUAL_REVIEW
    if (record.status === 'UNKNOWN' || record.status === 'UNKNOWN_NEEDS_REVIEW' || record.reconciliation_status === 'UNKNOWN' || record.reconciliation_status === 'MANUAL_REVIEW') {
      return {
        canPublish: false,
        status: record.reconciliation_status === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'UNKNOWN',
        reason: 'Record publication outcome is UNKNOWN or requires manual review. Automated publishing is blocked.',
      };
    }

    return {
      canPublish: true,
      status: 'CONFIRMED_NOT_PUBLISHED',
      reason: 'Idempotency verification passed. Safe to publish.',
    };
  }

  // ---------------------------------------------------------------------------
  // 7. Explicit State Marking Helpers
  // ---------------------------------------------------------------------------

  public async markPublished(
    recordId: string,
    mediaId: string,
    permalink: string,
    publishedAt?: string
  ): Promise<Confession> {
    const confession = mockStore.getConfessionById(recordId);
    if (!confession) throw new Error(`Confession ${recordId} not found`);

    const nowIso = publishedAt || new Date().toISOString();
    confession.status = 'PUBLISHED';
    confession.instagram_media_id = mediaId;
    confession.instagram_permalink = permalink;
    confession.published_at = nowIso;
    confession.reconciliation_status = 'ALREADY_PUBLISHED';
    confession.reconciliation_reason = `Verified publication (Media ID: ${mediaId}).`;
    confession.last_reconciled_at = nowIso;

    mockStore.addPublishedPost({
      confession_id: confession.id,
      confession_number: confession.google_sheet_row ?? 0,
      instagram_media_id: mediaId,
      permalink,
      published_at: nowIso,
      preview_text: (confession.cleaned_text || confession.original_text || '').slice(0, 80),
    });

    mockStore.updateConfession(confession.id, confession);
    await this.syncPublishedToSheet(confession);
    return confession;
  }

  public async markConfirmedFailed(recordId: string, reason: string): Promise<Confession> {
    const confession = mockStore.getConfessionById(recordId);
    if (!confession) throw new Error(`Confession ${recordId} not found`);

    const nowIso = new Date().toISOString();
    confession.status = 'FAILED_CONFIRMED';
    confession.reconciliation_status = 'CONFIRMED_NOT_PUBLISHED';
    confession.reconciliation_reason = reason;
    confession.error_message = reason;
    confession.last_reconciled_at = nowIso;

    mockStore.updateConfession(confession.id, confession);
    return confession;
  }

  public async markUnknown(recordId: string, reason: string): Promise<Confession> {
    const confession = mockStore.getConfessionById(recordId);
    if (!confession) throw new Error(`Confession ${recordId} not found`);

    const nowIso = new Date().toISOString();
    confession.status = 'UNKNOWN';
    confession.reconciliation_status = 'UNKNOWN';
    confession.reconciliation_reason = reason;
    confession.error_message = reason;
    confession.last_reconciled_at = nowIso;

    mockStore.updateConfession(confession.id, confession);
    return confession;
  }

  // ---------------------------------------------------------------------------
  // 8. Quarantine & Manual Review Administration
  // ---------------------------------------------------------------------------

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
      confession.reconciliation_status = 'DUPLICATE';
      confession.reconciliation_notes = 'Marked as duplicate by administrator.';
      await this.syncDuplicateToSheet(confession);
    } else if (resolution === 'ALLOW_POST') {
      confession.status = 'APPROVED';
      confession.reconciliation_status = 'CONFIRMED_NOT_PUBLISHED';
      confession.reconciliation_notes = 'Approved for publication override by administrator.';
    } else if (resolution === 'CANCEL') {
      confession.status = 'CANCELLED';
      confession.reconciliation_status = 'CONFIRMED_NOT_PUBLISHED';
      confession.reconciliation_notes = 'Publication cancelled by administrator.';
    }

    mockStore.updateConfession(confession.id, confession);
    return confession;
  }

  // ---------------------------------------------------------------------------
  // 9. Google Sheets Synchronization Helpers
  // ---------------------------------------------------------------------------

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
      console.warn(`[PublicationReconciliationService] Warning: Could not update sheet row #${confession.google_sheet_row}:`, err?.message || err);
    }
  }

  private async syncDuplicateToSheet(confession: Confession, reason?: string): Promise<void> {
    if (!confession.google_sheet_row) return;
    try {
      const config = mockStore.getGoogleSheetConfig();
      await googleSheetsService.updateRowStatus(config, confession.google_sheet_row, {
        status: 'DUPLICATE',
        processedAt: new Date().toISOString(),
        postId: confession.instagram_media_id || '',
        instagramUrl: confession.instagram_permalink || '',
        error: reason || confession.reconciliation_notes || 'Duplicate of already published post.',
      });
    } catch (err: any) {
      console.warn(`[PublicationReconciliationService] Warning: Could not update sheet row #${confession.google_sheet_row}:`, err?.message || err);
    }
  }

  /**
   * Reconciles a single confession by ID (backwards compatible with legacy callers)
   */
  public async reconcileConfession(
    id: string,
    options?: { forceLiveInstagram?: boolean }
  ): Promise<{
    confession: Confession;
    changed: boolean;
    reason: string;
    recordResult: ReconciliationRecordResult;
  }> {
    const recordResult = await this.reconcileRecord(id, options);
    const confession = mockStore.getConfessionById(id)!;
    return {
      confession,
      changed: recordResult.changed,
      reason: recordResult.reason,
      recordResult,
    };
  }

  /**
   * Reconciles all historical publishing states (alias for reconcileBatch)
   */
  public async reconcileHistoricalPublishingState(options?: {
    ids?: string[];
    forceLiveInstagram?: boolean;
    onProgress?: (current: number, total: number) => void;
  }): Promise<ReconciliationReport> {
    return this.reconcileBatch(options);
  }
}

export const publicationReconciliationService = new PublicationReconciliationService();
// Backwards compatible export
export const reconciliationService = publicationReconciliationService;
