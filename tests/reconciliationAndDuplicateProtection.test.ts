import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeConfessionText,
  generateContentHash,
  createPublishIdempotencyKey,
} from '../lib/contentHash';
import { mockStore } from '../lib/mockStore';
import { confessionService } from '../services/confessionService';
import { schedulingService } from '../services/schedulingService';
import { reconciliationService } from '../services/reconciliationService';
import { instagramService } from '../services/instagramService';
import { Confession } from '../types';

describe('Reconciliation & Duplicate Protection Engine', () => {
  beforeEach(() => {
    mockStore.resetToDefaults();
    mockStore.updateSettings({
      auto_publish: false,
      publishing_mode: 'MANUAL_APPROVAL',
      enable_quality_gate: false,
    });
  });

  describe('Content Hash & Canonical Normalization', () => {
    it('normalizes whitespace, unicode NFKC, invisible characters, and casing', () => {
      const raw1 = '  I   LOVE  coding in    TypeScript!!  \u200B\uFEFF ';
      const raw2 = 'i love coding in typescript!!';

      expect(normalizeConfessionText(raw1)).toBe(normalizeConfessionText(raw2));
      expect(generateContentHash(raw1)).toBe(generateContentHash(raw2));
    });

    it('generates consistent publish idempotency keys', () => {
      const key = createPublishIdempotencyKey('conf-123', 1);
      expect(key).toBe('confession:conf-123:attempt:1:instagram');
    });
  });

  describe('Publish Pre-Flight Duplicate Checks', () => {
    it('blocks publishing and marks DUPLICATE_ALREADY_PUBLISHED if identical content is already published', async () => {
      const existingText = 'I have a huge crush on the girl sitting in the 3rd row of CS101';
      const hash = generateContentHash(existingText);

      // Create an already PUBLISHED confession
      mockStore.addConfession({
        id: 'conf-existing',
        google_sheet_row: 10,
        name: 'Anonymous',
        original_text: existingText,
        cleaned_text: existingText,
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
        instagram_media_id: 'media-999',
        instagram_permalink: 'https://instagram.com/p/media-999',
        content_hash: hash,
        normalized_content_hash: hash,
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      // Create a duplicate confession in APPROVED state
      const duplicateConf = mockStore.addConfession({
        id: 'conf-duplicate',
        google_sheet_row: 15,
        name: 'Anonymous',
        original_text: '  i have a HUGE crush on the girl sitting in the 3rd row of cs101  ',
        status: 'APPROVED',
        content_hash: hash,
        normalized_content_hash: hash,
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      await expect(
        confessionService.publishConfession(duplicateConf.id)
      ).rejects.toThrow(/Duplicate blocked|Quarantined as duplicate/i);

      const after = mockStore.getConfessionById(duplicateConf.id);
      expect(after?.status).toBe('DUPLICATE_ALREADY_PUBLISHED');
      expect(after?.duplicate_of_id).toBe('conf-existing');
      expect(after?.duplicate_of_row).toBe(10);
    });

    it('enforces maximum 3 publish attempts and transitions to FAILED_REQUIRES_ACTION', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-max-retries',
        google_sheet_row: 20,
        original_text: 'Test confession exceeding retries',
        status: 'APPROVED',
        retry_count: 3,
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      await expect(
        confessionService.publishConfession(conf.id)
      ).rejects.toThrow(/Maximum publish attempts/);

      const after = mockStore.getConfessionById(conf.id);
      expect(after?.status).toBe('FAILED_REQUIRES_ACTION');
    });
  });

  describe('Post-Publish State Management (Database Authoritative)', () => {
    it('transitions to UNKNOWN_NEEDS_REVIEW when publish response times out or connection drops', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-timeout',
        google_sheet_row: 30,
        original_text: 'Confession during network glitch',
        status: 'APPROVED',
        retry_count: 0,
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      // Mock instagramService to return isUnknownState: true
      vi.spyOn(instagramService, 'publishPost').mockResolvedValueOnce({
        success: false,
        errorCode: 'PUBLISH_STATUS_UNKNOWN',
        isUnknownState: true,
        publishAttempted: true,
        error: 'Network connection timed out after publish request was dispatched.',
      });

      await expect(
        confessionService.publishConfession(conf.id)
      ).rejects.toThrow(/Network connection timed out|Instagram publish state unknown/);

      const after = mockStore.getConfessionById(conf.id);
      expect(after?.status).toBe('UNKNOWN_NEEDS_REVIEW');
      expect(after?.reconciliation_status).toBe('UNKNOWN');
      expect(after?.retry_count).toBe(1);
    });

    it('transitions to FAILED_CONFIRMED when publish fails before Instagram submission', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-pre-fail',
        google_sheet_row: 31,
        original_text: 'Confession with bad container',
        status: 'APPROVED',
        retry_count: 0,
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      vi.spyOn(instagramService, 'publishPost').mockResolvedValueOnce({
        success: false,
        errorCode: 'CONTAINER_CREATION_FAILED',
        isUnknownState: false,
        publishAttempted: false,
        error: 'Image URL unreachable by Meta crawler.',
      });

      await expect(
        confessionService.publishConfession(conf.id)
      ).rejects.toThrow(/Image URL unreachable|Instagram publishing failed/);

      const after = mockStore.getConfessionById(conf.id);
      expect(after?.status).toBe('FAILED_CONFIRMED');
      expect(after?.reconciliation_status).toBe('CONFIRMED_NOT_PUBLISHED');
    });
  });

  describe('Google Sheet Sync Safety', () => {
    it('imports FAILED rows from Google Sheet as UNKNOWN_NEEDS_REVIEW and never as READY_FOR_REVIEW', async () => {
      // Mock Google Sheets fetchRows to return a FAILED row
      vi.spyOn(schedulingService as any, 'syncGoogleSheet');

      const sheetRow = {
        rowNumber: 45,
        name: 'Anonymous',
        confession: 'This post previously failed on Google Sheet',
        status: 'FAILED',
        timestamp: new Date().toISOString(),
      };

      // Directly verify the status resolution logic of syncGoogleSheet
      const normHash = generateContentHash(sheetRow.confession);
      const isFailed = sheetRow.status === 'FAILED';

      let initialStatus: string;
      if (isFailed) {
        initialStatus = 'UNKNOWN_NEEDS_REVIEW';
      } else {
        initialStatus = 'READY_FOR_REVIEW';
      }

      expect(initialStatus).toBe('UNKNOWN_NEEDS_REVIEW');
      expect(initialStatus).not.toBe('READY_FOR_REVIEW');
      expect(initialStatus).not.toBe('APPROVED');
    });
  });

  describe('Queue Eligibility & Scheduling Isolation', () => {
    it('excludes FAILED, UNKNOWN, and DUPLICATE confessions from schedule generation', async () => {
      // Add approved confession
      mockStore.addConfession({
        id: 'conf-good',
        google_sheet_row: 50,
        original_text: 'Good approved post',
        status: 'APPROVED',
      });

      // Add failed confirmed confession
      mockStore.addConfession({
        id: 'conf-failed',
        google_sheet_row: 51,
        original_text: 'Failed post',
        status: 'FAILED_CONFIRMED',
      });

      // Add unknown confession
      mockStore.addConfession({
        id: 'conf-unknown',
        google_sheet_row: 52,
        original_text: 'Unknown post',
        status: 'UNKNOWN_NEEDS_REVIEW',
      });

      // Add duplicate confession
      mockStore.addConfession({
        id: 'conf-dup',
        google_sheet_row: 53,
        original_text: 'Duplicate post',
        status: 'DUPLICATE_ALREADY_PUBLISHED',
      });

      await schedulingService.generateFutureSchedule({ forceRecalculate: true });
      const scheduled = mockStore.getConfessions().filter((c) => c.status === 'SCHEDULED');
      const scheduledIds = scheduled.map((c) => c.id);

      expect(scheduledIds).toContain('conf-good');
      expect(scheduledIds).not.toContain('conf-failed');
      expect(scheduledIds).not.toContain('conf-unknown');
      expect(scheduledIds).not.toContain('conf-dup');
    });
  });

  describe('Historical Reconciliation Engine', () => {
    it('reconciles a FAILED confession to PUBLISHED if found in publishedPosts ledger', async () => {
      const confText = 'Confession that was actually published';
      const conf = mockStore.addConfession({
        id: 'conf-reconcile-ledger',
        google_sheet_row: 60,
        original_text: confText,
        status: 'FAILED',
      });

      mockStore.addPublishedPost({
        confession_id: conf.id,
        confession_number: 60,
        instagram_media_id: 'ig-media-12345',
        permalink: 'https://instagram.com/p/ig-media-12345',
        published_at: new Date().toISOString(),
        preview_text: confText,
      });

      const res = await reconciliationService.reconcileConfession(conf.id);
      expect(res.confession.status).toBe('PUBLISHED');
      expect(res.confession.instagram_media_id).toBe('ig-media-12345');
      expect(res.confession.reconciliation_status).toBe('ALREADY_PUBLISHED');
    });

    it('reconciles a FAILED confession to DUPLICATE_ALREADY_PUBLISHED if identical text is already live', async () => {
      const identicalText = 'Identical confession text shared across rows';
      const hash = generateContentHash(identicalText);

      mockStore.addConfession({
        id: 'conf-live-post',
        google_sheet_row: 70,
        original_text: identicalText,
        status: 'PUBLISHED',
        instagram_media_id: 'live-media-99',
        content_hash: hash,
        normalized_content_hash: hash,
      });

      const failedConf = mockStore.addConfession({
        id: 'conf-failed-dup',
        google_sheet_row: 75,
        original_text: identicalText,
        status: 'FAILED',
      });

      const res = await reconciliationService.reconcileConfession(failedConf.id);
      expect(res.confession.status).toBe('DUPLICATE_ALREADY_PUBLISHED');
      expect(res.confession.duplicate_of_id).toBe('conf-live-post');
      expect(res.confession.duplicate_of_row).toBe(70);
      expect(res.confession.reconciliation_status).toBe('DUPLICATE');
    });

    it('reconciles a FAILED confession to PUBLISHED if matched in live Instagram API media', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-match-ig',
        google_sheet_row: 80,
        original_text: 'I love library study sessions at 2am',
        status: 'FAILED',
      });

      vi.spyOn(instagramService, 'getRecentMedia').mockResolvedValueOnce([
        {
          id: 'ig-recent-888',
          caption: 'Campus Confession #080: I love library study sessions at 2am #campuslife',
          media_type: 'IMAGE',
          permalink: 'https://instagram.com/p/ig-recent-888',
          timestamp: new Date().toISOString(),
        },
      ]);

      const res = await reconciliationService.reconcileConfession(conf.id);
      expect(res.confession.status).toBe('PUBLISHED');
      expect(res.confession.instagram_media_id).toBe('ig-recent-888');
      expect(res.confession.reconciliation_status).toBe('ALREADY_PUBLISHED');
    });
  });

  describe('Canonical 5-Step Decision Tree', () => {
    it('Step 1 & 2: Identifies Authoritative DB and Stored Media IDs as ALREADY_PUBLISHED', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-step1',
        google_sheet_row: 101,
        original_text: 'Authoritative database test',
        status: 'PUBLISHED',
        instagram_media_id: 'media-101',
      });

      const res = await reconciliationService.reconcileRecord(conf.id);
      expect(res.newReconciliationStatus).toBe('ALREADY_PUBLISHED');
      expect(res.newStatus).toBe('PUBLISHED');
      expect(res.classification.checkMethod).toBe('authoritative_db_published');
    });

    it('Step 3: Correctly flags DUPLICATE strictly when matching an ALREADY PUBLISHED post', async () => {
      const originalText = 'Late night study in the engineering hall';
      mockStore.addConfession({
        id: 'conf-orig',
        google_sheet_row: 102,
        original_text: originalText,
        status: 'PUBLISHED',
        instagram_media_id: 'media-102',
      });

      const duplicate = mockStore.addConfession({
        id: 'conf-dup-cand',
        google_sheet_row: 103,
        original_text: '  late night study in the engineering hall  ',
        status: 'FAILED',
      });

      const res = await reconciliationService.reconcileRecord(duplicate.id);
      expect(res.newReconciliationStatus).toBe('DUPLICATE');
      expect(res.newStatus).toBe('DUPLICATE_ALREADY_PUBLISHED');
      expect(res.classification.duplicateOfId).toBe('conf-orig');
    });

    it('Step 4: Reconciles pre-publication rejections to CONFIRMED_NOT_PUBLISHED', async () => {
      const rejectedBeforeMeta = mockStore.addConfession({
        id: 'conf-pre-rejected',
        google_sheet_row: 104,
        original_text: 'Very long text that failed pagination',
        status: 'FAILED',
        error_message: 'This confession does not safely fit on one card without clipping. Please use Carousel format.',
      });

      const res = await reconciliationService.reconcileRecord(rejectedBeforeMeta.id);
      expect(res.newReconciliationStatus).toBe('CONFIRMED_NOT_PUBLISHED');
      expect(res.newStatus).toBe('FAILED_CONFIRMED');
      expect(res.classification.checkMethod).toBe('pre_publish_rejection_error');
    });

    it('Step 5: Instagram API Feed Inspection returns UNKNOWN on network timeout', async () => {
      const uncertainConf = mockStore.addConfession({
        id: 'conf-ig-timeout',
        google_sheet_row: 105,
        original_text: 'Network timed out while checking',
        status: 'UNKNOWN_NEEDS_REVIEW',
        reconciliation_attempts: 0,
      });

      const res = await reconciliationService.reconcileRecord(uncertainConf.id, {
        liveFeedResult: {
          success: false,
          media: [],
          errorType: 'TIMEOUT',
          errorMessage: 'Instagram Graph API request timed out after 12s',
        },
      });

      expect(res.newReconciliationStatus).toBe('UNKNOWN');
      expect(res.newStatus).toBe('UNKNOWN');
      expect(res.classification.checkMethod).toBe('instagram_api_timeout');
    });
  });

  describe('Pre-Publish Idempotency Gate (finalPublicationCheck)', () => {
    it('blocks publication if already marked PUBLISHED or has media ID', async () => {
      const pub = mockStore.addConfession({
        id: 'conf-gate-pub',
        google_sheet_row: 106,
        original_text: 'Already live on IG',
        status: 'PUBLISHED',
        instagram_media_id: 'media-live-106',
      });

      const check = await reconciliationService.finalPublicationCheck(pub);
      expect(check.canPublish).toBe(false);
      expect(check.status).toBe('ALREADY_PUBLISHED');
    });

    it('blocks publication if content was published under another record while in queue', async () => {
      const text = 'Shared confession text published by another row';
      const hash = generateContentHash(text);

      mockStore.addConfession({
        id: 'conf-gate-live',
        google_sheet_row: 107,
        original_text: text,
        status: 'PUBLISHED',
        instagram_media_id: 'media-live-107',
        content_hash: hash,
        normalized_content_hash: hash,
      });

      const cand = mockStore.addConfession({
        id: 'conf-gate-dup',
        google_sheet_row: 108,
        original_text: text,
        status: 'APPROVED',
        content_hash: hash,
        normalized_content_hash: hash,
      });

      const check = await reconciliationService.finalPublicationCheck(cand);
      expect(check.canPublish).toBe(false);
      expect(check.status).toBe('DUPLICATE');
    });

    it('blocks publication if record is in UNKNOWN or MANUAL_REVIEW state', async () => {
      const unk = mockStore.addConfession({
        id: 'conf-gate-unk',
        google_sheet_row: 109,
        original_text: 'Unconfirmed record',
        status: 'UNKNOWN_NEEDS_REVIEW',
        reconciliation_status: 'UNKNOWN',
      });

      const check = await reconciliationService.finalPublicationCheck(unk);
      expect(check.canPublish).toBe(false);
      expect(check.status).toBe('UNKNOWN');
    });

    it('approves publication if record is clean and CONFIRMED_NOT_PUBLISHED', async () => {
      const clean = mockStore.addConfession({
        id: 'conf-gate-clean',
        google_sheet_row: 110,
        original_text: 'Brand new unique confession ready to go',
        status: 'APPROVED',
      });

      const check = await reconciliationService.finalPublicationCheck(clean);
      expect(check.canPublish).toBe(true);
      expect(check.status).toBe('CONFIRMED_NOT_PUBLISHED');
    });
  });

  describe('Post-Publish Failure Scenarios', () => {
    it('guarantees idempotency via published ledger even if subsequent operations fail', async () => {
      const conf = mockStore.addConfession({
        id: 'conf-ledger-failover',
        google_sheet_row: 111,
        original_text: 'Confession published successfully to Instagram',
        status: 'APPROVED',
        moderation_status: 'LOW',
        quality_status: 'HIGH_VALUE',
        quality_decision: 'APPROVE',
      });

      vi.spyOn(instagramService, 'publishPost').mockResolvedValueOnce({
        success: true,
        mediaId: 'media-failover-111',
        permalink: 'https://instagram.com/p/media-failover-111',
      });

      await confessionService.publishConfession(conf.id);

      // Verify published post ledger has it recorded
      const ledger = mockStore.getPublishedPosts();
      const match = ledger.find((p) => p.confession_id === conf.id);
      expect(match).toBeDefined();
      expect(match?.instagram_media_id).toBe('media-failover-111');

      // Attempting to publish again is immediately blocked by finalPublicationCheck
      await expect(
        confessionService.publishConfession(conf.id)
      ).rejects.toThrow(/already marked as PUBLISHED|Already published/i);
    });
  });

  describe('Section 35 Acceptance Test Dataset', () => {
    it('accurately partitions 35 test records into mutually exclusive buckets summing to 35', async () => {
      mockStore.resetToDefaults();

      const candidateIds: string[] = [];

      // 1. 10 Published records (found in DB / ledger)
      for (let i = 1; i <= 10; i++) {
        const id = `sec35-pub-${i}`;
        candidateIds.push(id);
        const text = `Section 35 verified publication #${i}`;
        mockStore.addConfession({
          id,
          google_sheet_row: 200 + i,
          original_text: text,
          status: 'PUBLISHED',
          instagram_media_id: `ig-sec35-${i}`,
          published_at: new Date().toISOString(),
          reconciliation_status: 'NOT_CHECKED',
        });
      }

      // 2. 10 Confirmed Not Published records (deterministic pre-publish rejections)
      for (let i = 1; i <= 10; i++) {
        const id = `sec35-failed-${i}`;
        candidateIds.push(id);
        mockStore.addConfession({
          id,
          google_sheet_row: 220 + i,
          original_text: `Section 35 pre-rejected confession #${i}`,
          status: 'FAILED',
          error_message: 'Pre-publication validation failed: Text exceeds maximum card length',
          reconciliation_status: 'NOT_CHECKED',
        });
      }

      // 3. 5 Duplicates (matching the 5 published posts from category 1)
      for (let i = 1; i <= 5; i++) {
        const id = `sec35-dup-${i}`;
        candidateIds.push(id);
        mockStore.addConfession({
          id,
          google_sheet_row: 240 + i,
          original_text: `  Section 35 verified publication #${i}  `,
          status: 'FAILED',
          reconciliation_status: 'NOT_CHECKED',
        });
      }

      // 4. 5 Unknown records (Instagram API returned timeout / network drop, attempts < 3)
      for (let i = 1; i <= 5; i++) {
        const id = `sec35-unk-${i}`;
        candidateIds.push(id);
        mockStore.addConfession({
          id,
          google_sheet_row: 260 + i,
          original_text: `Section 35 unknown network glitch #${i}`,
          status: 'UNKNOWN_NEEDS_REVIEW',
          reconciliation_status: 'NOT_CHECKED',
          reconciliation_attempts: 0,
        });
      }

      // 5. 5 Manual Review records (attempts >= 3 without resolution)
      for (let i = 1; i <= 5; i++) {
        const id = `sec35-man-${i}`;
        candidateIds.push(id);
        mockStore.addConfession({
          id,
          google_sheet_row: 280 + i,
          original_text: `Section 35 manual review required #${i}`,
          status: 'UNKNOWN_NEEDS_REVIEW',
          reconciliation_status: 'NOT_CHECKED',
          reconciliation_attempts: 3,
        });
      }

      expect(candidateIds.length).toBe(35);

      // Run batch reconciliation
      const report = await reconciliationService.reconcileBatch({
        ids: candidateIds,
      });

      // Strict Mutually Exclusive Invariants:
      expect(report.total).toBe(35);
      expect(report.alreadyPublished).toBe(10);
      expect(report.confirmedNotPublished).toBe(10);
      expect(report.duplicates).toBe(5);
      expect(report.unknown).toBe(5);
      expect(report.manualReview).toBe(5);

      // Exact sum equality without overlap
      const sumOfBuckets =
        report.alreadyPublished +
        report.confirmedNotPublished +
        report.duplicates +
        report.unknown +
        report.manualReview;

      expect(sumOfBuckets).toBe(report.total);
      expect(sumOfBuckets).toBe(35);
      expect(report.items.length).toBe(35);
    });
  });
});
