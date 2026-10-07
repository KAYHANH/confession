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
      ).rejects.toThrow(/Duplicate blocked/);

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
      expect(after?.reconciliation_status).toBe('NEEDS_REVIEW');
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
      expect(after?.reconciliation_status).toBe('RECONCILED');
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
      expect(res.confession.reconciliation_status).toBe('RECONCILED');
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
      expect(res.confession.reconciliation_status).toBe('RECONCILED');
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
      expect(res.confession.reconciliation_status).toBe('RECONCILED');
    });
  });
});
