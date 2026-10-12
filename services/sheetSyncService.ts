import { confessionService } from './confessionService';
import { googleSheetsService, RawSheetRow, SheetRowUpdate } from './googleSheetsService';
import { reconciliationService } from './reconciliationService';
import { moderationService } from './moderationService';
import { confessionQualityService } from './quality/confessionQualityService';
import { mockStore } from '@/lib/mockStore';
import { generateContentHash, normalizeConfessionText } from '@/lib/contentHash';
import { buildInstagramCaption } from '@/lib/paginationEngine';
import {
  Confession,
  ConfessionStatus,
  SheetSyncReport,
  SheetSyncItem,
  SheetSyncActionTaken,
} from '@/types';

export class SheetSyncService {
  private isSyncInProgress = false;

  public isRunning(): boolean {
    return this.isSyncInProgress;
  }

  /**
   * Comprehensive Bidirectional Full Google Sheets Synchronization
   */
  public async syncGoogleSheet(options?: {
    onProgress?: (stepMessage: string, current: number, total: number) => void;
  }): Promise<SheetSyncReport> {
    const startTime = Date.now();
    this.isSyncInProgress = true;

    const report: SheetSyncReport = {
      totalRowsExamined: 0,
      newRowsImported: 0,
      existingRecordsUpdated: 0,
      alreadyPublishedVerified: 0,
      queuedRecords: 0,
      scheduledRecords: 0,
      confirmedFailedRecords: 0,
      unknownRecords: 0,
      duplicatesDetected: 0,
      lowValueOrReviewRecords: 0,
      deletedRecords: 0,
      sheetUpdatesSuccessful: 0,
      sheetUpdatesFailed: 0,
      errors: [],
      reconciliationItems: [],
      completedAt: '',
      durationMs: 0,
      imported: 0,
      processed: 0,
      deleted: 0,
    };

    try {
      const config = mockStore.getGoogleSheetConfig();
      options?.onProgress?.('Reading Google Sheet rows...', 0, 100);

      const rows: RawSheetRow[] = await googleSheetsService.fetchRows(config);
      report.totalRowsExamined = rows.length;
      report.processed = rows.length;

      // Load all confessions from both mockStore and DB
      const mockConfessions = mockStore.getConfessions();
      let dbConfessions: Confession[] = [];
      const useSupabase =
        process.env.DISABLE_SUPABASE !== 'true' &&
        process.env.USE_SUPABASE !== 'false' &&
        process.env.MOCK_EXTERNAL_APIS !== 'true' &&
        !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

      if (useSupabase) {
        try {
          const allPages = await confessionService.getConfessions({ limit: 1000 });
          dbConfessions = allPages.confessions || [];
        } catch (err: any) {
          console.warn('[SheetSyncService] Supabase fetch warning:', err?.message || err);
        }
      }

      // Merge and deduplicate DB records by id
      const existingMap = new Map<string, Confession>();
      for (const c of [...mockConfessions, ...dbConfessions]) {
        existingMap.set(c.id, c);
      }
      const existing = Array.from(existingMap.values());
      const deletedRowNumbers = mockStore.getDeletedRowNumbers();

      // Track published hashes and ledger for instant duplicate protection
      const publishedHashes = new Set<string>();
      for (const c of existing) {
        if ((c.status === 'PUBLISHED' || !!c.instagram_media_id) && (c.normalized_content_hash || c.content_hash)) {
          publishedHashes.add(c.normalized_content_hash || c.content_hash || '');
        }
      }
      for (const p of mockStore.getPublishedPosts()) {
        if (p.preview_text) {
          publishedHashes.add(generateContentHash(p.preview_text));
        }
      }

      // ─── Step 1: Reconcile Row Deletions Upstream ─────────────────────────
      const sheetRowNumbers = new Set(rows.map((r) => r.rowNumber));
      const sheetRowsByHash = new Map<string, RawSheetRow>();
      for (const r of rows) {
        if (r.confession && r.confession.trim().length > 0) {
          sheetRowsByHash.set(generateContentHash(r.confession), r);
        }
      }
      const maxSheetRow = rows.length > 0 ? Math.max(...rows.map((r) => r.rowNumber)) : 0;

      for (const c of existing) {
        if (!c.google_sheet_row || c.status === 'DELETED') continue;

        const confHash = c.normalized_content_hash || c.content_hash || generateContentHash(c.cleaned_text || c.original_text || '');
        const isStillInSheetByRow = sheetRowNumbers.has(c.google_sheet_row);
        const rowAtSameIndex = rows.find((r) => r.rowNumber === c.google_sheet_row);
        const isMarkedDeletedInSheet = rowAtSameIndex && (rowAtSameIndex.status || '').trim().toUpperCase() === 'DELETED';

        const matchingRowByHash = sheetRowsByHash.get(confHash);
        const isHashClaimedByAnother = matchingRowByHash && existing.some(
          (other) => other.id !== c.id && other.google_sheet_row === matchingRowByHash.rowNumber && other.status !== 'DELETED'
        );

        const isDeletedFromSheet =
          isMarkedDeletedInSheet ||
          c.google_sheet_row > maxSheetRow ||
          (!isStillInSheetByRow && (!matchingRowByHash || isHashClaimedByAnother));

        if (isDeletedFromSheet) {
          deletedRowNumbers.add(c.google_sheet_row);
          report.deletedRecords++;

          const updatePayload: Partial<Confession> = {
            status: 'DELETED',
            deleted_at: new Date().toISOString(),
            scheduled_at: null,
            error_message: 'Deleted in Google Sheet',
          };
          mockStore.updateConfession(c.id, updatePayload);
          if (useSupabase) {
            confessionService.deleteConfession(c.id, false).catch(() => {});
          }

          report.reconciliationItems.push({
            rowNumber: c.google_sheet_row,
            confessionId: c.id,
            submitter: c.display_name || c.name,
            textPreview: (c.original_text || '').slice(0, 50),
            sheetStatusBefore: rowAtSameIndex?.status || 'UNKNOWN',
            sheetStatusAfter: 'DELETED',
            dbStatus: 'DELETED',
            actionTaken: 'MARKED_DELETED',
            evidence: 'Confession row was removed or cleared in Google Sheet',
          });
        }
      }

      if (report.deletedRecords > 0) {
        mockStore.setDeletedRowNumbers(Array.from(deletedRowNumbers));
      }

      // ─── Step 2: 3-Tier Record Identity Matching & Processing ─────────────
      const sheetUpdates: SheetRowUpdate[] = [];
      const newConfessionsToInsert: Confession[] = [];
      const now = new Date();
      const settings = mockStore.getSettings();

      let processedCount = 0;
      for (const row of rows) {
        processedCount++;
        if (processedCount % 10 === 0 || processedCount === rows.length) {
          options?.onProgress?.(
            `Reconciling publication states: ${processedCount} / ${rows.length}`,
            processedCount,
            rows.length
          );
        }

        // Skip rows deleted by user or marked DELETED
        if (deletedRowNumbers.has(row.rowNumber)) {
          continue;
        }

        const rawStatus = (row.status || '').trim().toUpperCase();
        if (rawStatus === 'DELETED') {
          if (!deletedRowNumbers.has(row.rowNumber)) {
            deletedRowNumbers.add(row.rowNumber);
            mockStore.setDeletedRowNumbers(Array.from(deletedRowNumbers));
          }
          continue;
        }

        const rawText = (row.confession || '').trim();
        if (!rawText) continue;

        const rowHash = generateContentHash(rawText);

        // Tier 1: Stable ID matching
        let matchedConf: Confession | undefined = undefined;
        if (row.id) {
          matchedConf = existing.find((c) => c.id === row.id || (c as any).form_response_id === row.id);
        }

        // Tier 2: Row number match
        if (!matchedConf) {
          matchedConf = existing.find((c) => c.google_sheet_row === row.rowNumber && c.status !== 'DELETED');
        }

        // Tier 3: Hash + Submission Timestamp matching for shifted rows
        if (!matchedConf) {
          const candidateShift = existing.find(
            (c) =>
              c.status !== 'DELETED' &&
              (c.normalized_content_hash === rowHash || c.content_hash === rowHash)
          );
          if (candidateShift) {
            // Row shifted upstream in Google Sheet! Update row reference without creating duplicate.
            candidateShift.google_sheet_row = row.rowNumber;
            matchedConf = candidateShift;
            mockStore.updateConfession(candidateShift.id, { google_sheet_row: row.rowNumber });
            if (useSupabase) {
              confessionService.updateConfession(candidateShift.id, { google_sheet_row: row.rowNumber }).catch(() => {});
            }
          }
        }

        // ─── EXISTING CONFESSION FOUND ──────────────────────────────────────
        if (matchedConf) {
          report.existingRecordsUpdated++;

          // Guard against post-publication text modifications:
          // If already published, editing text in the Sheet should NOT republish or change status!
          const isDbPublished = matchedConf.status === 'PUBLISHED' || !!matchedConf.instagram_media_id;
          if (isDbPublished) {
            report.alreadyPublishedVerified++;

            // Ensure Sheet reflects authoritative published info
            const needsSheetCorrection =
              rawStatus !== 'PUBLISHED' && rawStatus !== 'POSTED';

            if (needsSheetCorrection || !row.postId || !row.instagramUrl) {
              sheetUpdates.push({
                rowNumber: row.rowNumber,
                status: 'PUBLISHED',
                postId: matchedConf.instagram_media_id || row.postId || 'verified-published',
                instagramUrl: matchedConf.instagram_permalink || row.instagramUrl || '',
                processedAt: matchedConf.published_at || row.processedAt || new Date().toISOString(),
                error: '',
              });

              report.reconciliationItems.push({
                rowNumber: row.rowNumber,
                confessionId: matchedConf.id,
                submitter: matchedConf.display_name || row.name,
                textPreview: rawText.slice(0, 50),
                sheetStatusBefore: row.status || 'EMPTY',
                sheetStatusAfter: 'PUBLISHED',
                dbStatus: 'PUBLISHED',
                actionTaken: 'PUBLICATION_VERIFIED',
                evidence: `Authoritative DB/Instagram publication verified (Media ID: ${matchedConf.instagram_media_id}). Stale sheet status corrected.`,
              });
            } else {
              report.reconciliationItems.push({
                rowNumber: row.rowNumber,
                confessionId: matchedConf.id,
                submitter: matchedConf.display_name || row.name,
                textPreview: rawText.slice(0, 50),
                sheetStatusBefore: row.status,
                sheetStatusAfter: 'PUBLISHED',
                dbStatus: 'PUBLISHED',
                actionTaken: 'UNCHANGED',
                evidence: 'Already verified published with valid links in both Sheet and DB.',
              });
            }
            continue;
          }

          // Not published in DB: check if reconciliation service finds publication evidence
          const pubMatch = await reconciliationService.findExistingPublication(matchedConf);
          if (pubMatch && pubMatch.isPublished) {
            report.alreadyPublishedVerified++;
            const pubUpdate = {
              status: 'PUBLISHED' as ConfessionStatus,
              published_at: pubMatch.publishedAt || new Date().toISOString(),
              instagram_media_id: pubMatch.mediaId || 'reconciled-published',
              instagram_permalink: pubMatch.permalink || '',
              reconciliation_status: 'RECONCILED' as const,
              reconciliation_notes: pubMatch.evidence,
            };
            mockStore.updateConfession(matchedConf.id, pubUpdate);
            if (useSupabase) {
              confessionService.updateConfession(matchedConf.id, pubUpdate).catch(() => {});
            }

            sheetUpdates.push({
              rowNumber: row.rowNumber,
              status: 'PUBLISHED',
              postId: pubMatch.mediaId || '',
              instagramUrl: pubMatch.permalink || '',
              processedAt: pubMatch.publishedAt || new Date().toISOString(),
              error: '',
            });

            report.reconciliationItems.push({
              rowNumber: row.rowNumber,
              confessionId: matchedConf.id,
              submitter: matchedConf.display_name || row.name,
              textPreview: rawText.slice(0, 50),
              sheetStatusBefore: row.status,
              sheetStatusAfter: 'PUBLISHED',
              dbStatus: 'PUBLISHED',
              actionTaken: 'PUBLICATION_VERIFIED',
              evidence: pubMatch.evidence,
            });
            continue;
          }

          // Check if it is a duplicate of an already published confession
          const dupMatch = reconciliationService.findPublishedDuplicateMatch(matchedConf);
          if (dupMatch && dupMatch.isDuplicate) {
            report.duplicatesDetected++;
            const dupUpdate = {
              status: 'DUPLICATE_ALREADY_PUBLISHED' as ConfessionStatus,
              duplicate_of_id: dupMatch.duplicateOfId,
              duplicate_of_row: dupMatch.duplicateOfRow,
              duplicate_of_permalink: dupMatch.duplicateOfPermalink,
              reconciliation_status: 'RECONCILED' as const,
              reconciliation_notes: dupMatch.evidence,
            };
            mockStore.updateConfession(matchedConf.id, dupUpdate);
            if (useSupabase) {
              confessionService.updateConfession(matchedConf.id, dupUpdate).catch(() => {});
            }

            if (rawStatus !== 'DUPLICATE') {
              sheetUpdates.push({
                rowNumber: row.rowNumber,
                status: 'DUPLICATE',
                error: `Duplicate of published confession #${dupMatch.duplicateOfRow || dupMatch.duplicateOfId}`,
              });
              report.reconciliationItems.push({
                rowNumber: row.rowNumber,
                confessionId: matchedConf.id,
                submitter: matchedConf.display_name || row.name,
                textPreview: rawText.slice(0, 50),
                sheetStatusBefore: row.status,
                sheetStatusAfter: 'DUPLICATE',
                dbStatus: 'DUPLICATE_ALREADY_PUBLISHED',
                actionTaken: 'QUARANTINED_DUPLICATE',
                evidence: dupMatch.evidence,
              });
            }
            continue;
          }

          // If Sheet explicitly marked PUBLISHED/POSTED by user with media/url info
          if (rawStatus === 'PUBLISHED' || rawStatus === 'POSTED') {
            report.alreadyPublishedVerified++;
            const pubPayload = {
              status: 'PUBLISHED' as ConfessionStatus,
              published_at: row.processedAt || matchedConf.published_at || new Date().toISOString(),
              instagram_media_id: row.postId || matchedConf.instagram_media_id || 'sheet-manual-published',
              instagram_permalink: row.instagramUrl || matchedConf.instagram_permalink || null,
              reconciliation_status: 'RECONCILED' as const,
              reconciliation_notes: 'Synchronized from Google Sheet marked PUBLISHED.',
            };
            mockStore.updateConfession(matchedConf.id, pubPayload);
            if (useSupabase) {
              confessionService.updateConfession(matchedConf.id, pubPayload).catch(() => {});
            }
            continue;
          }

          // Sync DB workflow status back to Google Sheet!
          let targetSheetStatus = rawStatus;
          let sheetError = row.error || '';

          if (matchedConf.status === 'SCHEDULED') {
            targetSheetStatus = 'SCHEDULED';
            report.scheduledRecords++;
          } else if (matchedConf.status === 'APPROVED') {
            targetSheetStatus = 'QUEUED';
            report.queuedRecords++;
          } else if (matchedConf.status === 'READY_FOR_REVIEW') {
            targetSheetStatus = 'PENDING REVIEW';
            report.lowValueOrReviewRecords++;
          } else if (
            matchedConf.status === 'FAILED' ||
            matchedConf.status === 'FAILED_CONFIRMED' ||
            matchedConf.status === 'FAILED_REQUIRES_ACTION'
          ) {
            targetSheetStatus = 'FAILED';
            sheetError = matchedConf.error_message || 'Confirmed publishing failure';
            report.confirmedFailedRecords++;
          } else if (matchedConf.status === 'UNKNOWN' || matchedConf.status === 'UNKNOWN_NEEDS_REVIEW') {
            targetSheetStatus = 'UNKNOWN';
            sheetError = matchedConf.reconciliation_notes || 'Unconfirmed publication held for reconciliation';
            report.unknownRecords++;
          } else if (matchedConf.status === 'REJECTED') {
            targetSheetStatus = 'REJECTED';
            report.lowValueOrReviewRecords++;
          }

          if (targetSheetStatus !== rawStatus) {
            sheetUpdates.push({
              rowNumber: row.rowNumber,
              status: targetSheetStatus,
              scheduledAt: matchedConf.scheduled_at || undefined,
              error: sheetError,
            });

            report.reconciliationItems.push({
              rowNumber: row.rowNumber,
              confessionId: matchedConf.id,
              submitter: matchedConf.display_name || row.name,
              textPreview: rawText.slice(0, 50),
              sheetStatusBefore: row.status || 'EMPTY',
              sheetStatusAfter: targetSheetStatus,
              dbStatus: matchedConf.status,
              actionTaken: 'STATUS_CORRECTED',
              evidence: `Sheet status synced from database status (${matchedConf.status}).`,
            });
          }
          continue;
        }

        // ─── NEW CONFESSION SUBMISSION ──────────────────────────────────────
        const newId = `confession-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const enablePii = settings.enable_pii_detection !== false;
        const moderationResult = moderationService.analyzeContent(rawText, enablePii);
        const cleanedText = enablePii
          ? moderationService.maskSensitiveInformation(rawText, moderationResult.piiDetected)
          : rawText;
        const normHash = generateContentHash(cleanedText);

        // Quality Gate evaluation
        const qualityResult = await confessionQualityService.evaluateConfession(cleanedText, {
          existingPool: existing.map((c) => ({
            id: c.id,
            row: c.google_sheet_row,
            text: c.cleaned_text || c.original_text,
          })),
          confessionId: newId,
        });

        // Check if identical content was already published anywhere (DB or Ledger)
        const alreadyPublishedWithHash = existing.find(
          (c) =>
            (c.status === 'PUBLISHED' || !!c.instagram_media_id) &&
            (c.normalized_content_hash === normHash || c.content_hash === normHash)
        );

        // Also check published posts ledger
        const publishedLedger = mockStore.getPublishedPosts();
        const ledgerMatch = publishedLedger.find((p) => {
          if (row.rowNumber && p.confession_number === row.rowNumber) return true;
          if (p.preview_text && normalizeConfessionText(p.preview_text) === normalizeConfessionText(rawText)) return true;
          return false;
        });

        const isSheetPublished = rawStatus === 'PUBLISHED' || rawStatus === 'POSTED';
        const isSheetRejected = rawStatus === 'REJECTED';
        const isSheetScheduled = rawStatus === 'SCHEDULED';
        const isSheetFailed = rawStatus === 'FAILED' || rawStatus === 'FAILED_CONFIRMED';
        const isSheetUnknown = rawStatus === 'UNKNOWN' || rawStatus === 'UNKNOWN_NEEDS_REVIEW';

        let initialStatus: ConfessionStatus;
        let actionTaken: SheetSyncActionTaken = 'IMPORTED';
        let evidenceNote = 'New submission imported into moderation queue.';

        if (alreadyPublishedWithHash) {
          initialStatus = 'DUPLICATE_ALREADY_PUBLISHED';
          actionTaken = 'QUARANTINED_DUPLICATE';
          evidenceNote = `Duplicate of published confession #${alreadyPublishedWithHash.google_sheet_row || alreadyPublishedWithHash.id}`;
          report.duplicatesDetected++;
        } else if (ledgerMatch) {
          initialStatus = 'PUBLISHED';
          actionTaken = 'PUBLICATION_VERIFIED';
          evidenceNote = `Historical publication verified in published ledger (Media ID: ${ledgerMatch.instagram_media_id}).`;
          report.alreadyPublishedVerified++;
        } else if (isSheetPublished) {
          initialStatus = 'PUBLISHED';
          actionTaken = 'PUBLICATION_VERIFIED';
          evidenceNote = 'Historical row already marked PUBLISHED in Google Sheet.';
          report.alreadyPublishedVerified++;
        } else if (isSheetRejected) {
          initialStatus = 'REJECTED';
          report.lowValueOrReviewRecords++;
        } else if (isSheetScheduled) {
          initialStatus = 'SCHEDULED';
          report.scheduledRecords++;
        } else if (isSheetFailed || isSheetUnknown) {
          // Historical failure row: quarantine for reconciliation, NEVER mark ready to post blindly!
          initialStatus = 'UNKNOWN_NEEDS_REVIEW';
          evidenceNote = 'Historical row has failed/unknown status. Quarantined for review.';
          report.unknownRecords++;
        } else if (settings.auto_reject_low_value !== false && qualityResult.qualityStatus === 'LOW_VALUE') {
          initialStatus = 'REJECTED';
          report.lowValueOrReviewRecords++;
          evidenceNote = `Held by Quality Policy Gate: ${qualityResult.reason}`;
        } else {
          initialStatus = 'READY_FOR_REVIEW';
          report.lowValueOrReviewRecords++;
        }

        const isAnon =
          row.isAnonymous !== undefined
            ? row.isAnonymous
            : ((row.name || '').toLowerCase() === 'anonymous' || !row.name);

        const newConf: Confession = {
          id: newId,
          google_sheet_id: config.spreadsheet_id,
          google_sheet_name: config.sheet_name,
          google_sheet_row: row.rowNumber,
          name: row.name || 'Anonymous',
          original_text: row.confession,
          cleaned_text: cleanedText,
          display_name: isAnon ? 'Anonymous' : (row.name || 'Anonymous'),
          is_anonymous: isAnon,
          status: initialStatus,
          content_hash: normHash,
          normalized_content_hash: normHash,
          duplicate_of_id: alreadyPublishedWithHash?.id ?? null,
          duplicate_of_row: alreadyPublishedWithHash?.google_sheet_row ?? null,
          duplicate_of_permalink: alreadyPublishedWithHash?.instagram_permalink ?? null,
          reconciliation_status: alreadyPublishedWithHash
            ? 'RECONCILED'
            : (isSheetPublished || ledgerMatch)
            ? 'RECONCILED'
            : (isSheetFailed || isSheetUnknown)
            ? 'NEEDS_REVIEW'
            : null,
          reconciliation_notes: evidenceNote,
          moderation_status: moderationResult.risk,
          moderation_reason:
            moderationResult.reasons.length > 0 ? moderationResult.reasons.join('; ') : 'Passed safety validation.',
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
          published_at: isSheetPublished
            ? (row.processedAt || row.timestamp || new Date().toISOString())
            : ledgerMatch
            ? (ledgerMatch.published_at || new Date().toISOString())
            : null,
          instagram_media_id: isSheetPublished
            ? (row.postId || 'sheet-imported-published')
            : ledgerMatch
            ? (ledgerMatch.instagram_media_id || 'ledger-published')
            : null,
          instagram_permalink: isSheetPublished
            ? (row.instagramUrl || null)
            : ledgerMatch
            ? (ledgerMatch.permalink || null)
            : null,
          retry_count: 0,
          error_message: null,
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

        newConfessionsToInsert.push(newConf);
        report.newRowsImported++;
        existing.push(newConf);

        // Map initial sheet status update if needed
        if (ledgerMatch && rawStatus !== 'PUBLISHED') {
          sheetUpdates.push({
            rowNumber: row.rowNumber,
            status: 'PUBLISHED',
            postId: ledgerMatch.instagram_media_id || '',
            instagramUrl: ledgerMatch.permalink || '',
            processedAt: ledgerMatch.published_at || new Date().toISOString(),
            error: '',
          });
        } else if (initialStatus === 'DUPLICATE_ALREADY_PUBLISHED') {
          sheetUpdates.push({
            rowNumber: row.rowNumber,
            status: 'DUPLICATE',
            error: evidenceNote,
          });
        } else if (initialStatus === 'REJECTED' && qualityResult.qualityStatus === 'LOW_VALUE') {
          sheetUpdates.push({
            rowNumber: row.rowNumber,
            status: 'REJECTED',
            error: `Low-value content: ${qualityResult.reason}`,
          });
        }

        report.reconciliationItems.push({
          rowNumber: row.rowNumber,
          confessionId: newId,
          submitter: newConf.display_name,
          textPreview: rawText.slice(0, 50),
          sheetStatusBefore: row.status || 'NEW',
          sheetStatusAfter: initialStatus === 'READY_FOR_REVIEW' ? 'PENDING REVIEW' : initialStatus,
          dbStatus: initialStatus,
          actionTaken,
          evidence: evidenceNote,
        });
      }

      // Save all new confessions to mockStore and Supabase
      if (newConfessionsToInsert.length > 0) {
        mockStore.addConfessions(newConfessionsToInsert);
        if (useSupabase) {
          for (const conf of newConfessionsToInsert) {
            await confessionService.createConfession(conf as any).catch((err: any) => {
              console.warn('[SheetSyncService] Supabase insert warning:', err?.message || err);
            });
          }
        }
      }

      // ─── Step 3: Batch Update Sheet Statuses ─────────────────────────────
      if (sheetUpdates.length > 0) {
        options?.onProgress?.(
          `Updating Google Sheet statuses: ${sheetUpdates.length} row(s)...`,
          0,
          sheetUpdates.length
        );

        const updateRes = await googleSheetsService.batchUpdateRowStatuses(config, sheetUpdates);
        report.sheetUpdatesSuccessful = updateRes.successful;
        report.sheetUpdatesFailed = updateRes.failed;
        if (updateRes.errors.length > 0) {
          report.errors.push(...updateRes.errors);
        }
      }

      // ─── Step 4: Schedule Recalculation (if new rows or deletions) ────────
      if (newConfessionsToInsert.length > 0 || report.deletedRecords > 0) {
        try {
          const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
          await adaptiveSchedulingEngine.recalculateFutureQueue();
        } catch (err: any) {
          console.warn('[SheetSyncService] Schedule recalculation warning:', err?.message || err);
        }
      }

      // Auto-approve eligible low-risk if configured (WITHOUT publishing!)
      if (
        settings.publishing_mode === 'AUTO_APPROVAL' ||
        settings.publishing_mode === 'AUTO_PUBLISH' ||
        settings.auto_publish
      ) {
        try {
          const { schedulingService } = await import('./schedulingService');
          await schedulingService.autoApproveEligibleConfessions();
        } catch {}
      }

      // Update sync metadata in Google Sheet config
      mockStore.updateGoogleSheetConfig({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'SUCCESS',
        rows_imported: (config.rows_imported || 0) + newConfessionsToInsert.length,
      });

      mockStore.addLog({
        action: 'SHEET_SYNC',
        entity_type: 'sheet',
        metadata: {
          imported: newConfessionsToInsert.length,
          updated: report.existingRecordsUpdated,
          deleted: report.deletedRecords,
          totalInSheet: rows.length,
          sheetUpdatesCount: sheetUpdates.length,
        },
      });

      report.imported = newConfessionsToInsert.length;
      report.deleted = report.deletedRecords;
      report.completedAt = new Date().toISOString();
      report.durationMs = Date.now() - startTime;

      options?.onProgress?.('Synchronization complete.', rows.length, rows.length);
      return report;
    } catch (err: any) {
      console.error('[SheetSyncService] Sheet synchronization error:', err?.message || err);
      report.errors.push(err?.message || 'Synchronization failed');
      report.completedAt = new Date().toISOString();
      report.durationMs = Date.now() - startTime;
      throw err;
    } finally {
      this.isSyncInProgress = false;
    }
  }
}

export const sheetSyncService = new SheetSyncService();
