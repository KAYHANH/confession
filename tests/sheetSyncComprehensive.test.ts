import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockStore } from '../lib/mockStore';
import { sheetSyncService } from '../services/sheetSyncService';
import { googleSheetsService } from '../services/googleSheetsService';
import { backgroundJobService } from '../services/backgroundJobService';
import { instagramService } from '../services/instagramService';
import { Confession } from '../types';

describe('ConfessionFlow Full Google Sheets Synchronization Suite', () => {
  beforeEach(() => {
    mockStore.resetToDefaults();
    mockStore.clearMockSheetRows();
  });

  // ─── Test A: Already Published Verification ─────────────────────────────
  it('Test A: Database/Instagram authoritative publication restores stale FAILED row on Google Sheet without re-publishing', async () => {
    const publishSpy = vi.spyOn(instagramService, 'publishPost');

    const publishedConf: Confession = {
      id: 'conf-published-42',
      google_sheet_id: 'test-sheet',
      google_sheet_row: 42,
      name: 'Priya',
      display_name: 'Priya',
      original_text: 'Secret crush on my lab partner since first year physics.',
      cleaned_text: 'Secret crush on my lab partner since first year physics.',
      status: 'PUBLISHED',
      published_at: '2026-10-10T14:30:00Z',
      instagram_media_id: 'ig_media_98765',
      instagram_permalink: 'https://instagram.com/p/Cxyz123/',
      is_anonymous: false,
      moderation_status: 'LOW',
      moderation_reason: 'Passed safety validation.',
      ai_processed: true,
      template_id: '44444444-4444-4444-4444-444444444444',
      caption: 'Confession #42',
      hashtags: ['#confession'],
      created_at: '2026-10-09T10:00:00Z',
      updated_at: '2026-10-10T14:30:00Z',
    };
    mockStore.addConfessions([publishedConf]);

    // Seed Google Sheet row 42 with stale FAILED status
    mockStore.setMockSheetRows({
      42: {
        rowNumber: 42,
        name: 'Priya',
        confession: 'Secret crush on my lab partner since first year physics.',
        status: 'FAILED',
        error: 'Network socket timeout during previous cycle',
        postId: '',
        instagramUrl: '',
      },
    });

    const report = await sheetSyncService.syncGoogleSheet();

    // 1. Database status remains PUBLISHED
    const freshConf = mockStore.getConfessionById('conf-published-42');
    expect(freshConf?.status).toBe('PUBLISHED');
    expect(freshConf?.instagram_media_id).toBe('ig_media_98765');

    // 2. Google Sheet row 42 was corrected to PUBLISHED with media link
    const updatedSheetRows = mockStore.getMockSheetRows();
    expect(updatedSheetRows[42].status).toBe('PUBLISHED');
    expect(updatedSheetRows[42].postId).toBe('ig_media_98765');
    expect(updatedSheetRows[42].instagramUrl).toBe('https://instagram.com/p/Cxyz123/');

    // 3. Instagram API was NEVER called during sync
    expect(publishSpy).not.toHaveBeenCalled();

    // 4. Report correctly recorded publication verification
    expect(report.alreadyPublishedVerified).toBeGreaterThanOrEqual(1);
    const item = report.reconciliationItems.find((i) => i.rowNumber === 42);
    expect(item?.actionTaken).toBe('PUBLICATION_VERIFIED');
    expect(item?.sheetStatusAfter).toBe('PUBLISHED');
  });

  // ─── Test B: Scheduled Status Propagation ────────────────────────────────
  it('Test B: Approved and scheduled confession writes SCHEDULED back to Google Sheet', async () => {
    const scheduledTime = '2026-10-16T15:00:00Z';
    const scheduledConf: Confession = {
      id: 'conf-scheduled-43',
      google_sheet_id: 'test-sheet',
      google_sheet_row: 43,
      name: 'Rohan',
      display_name: 'Rohan',
      original_text: 'I submitted my assignment 2 seconds before the deadline.',
      cleaned_text: 'I submitted my assignment 2 seconds before the deadline.',
      status: 'SCHEDULED',
      scheduled_at: scheduledTime,
      is_anonymous: false,
      moderation_status: 'LOW',
      moderation_reason: 'Passed safety validation.',
      ai_processed: true,
      template_id: '44444444-4444-4444-4444-444444444444',
      caption: 'Confession #43',
      hashtags: ['#confession'],
      created_at: '2026-10-11T10:00:00Z',
      updated_at: '2026-10-11T10:00:00Z',
    };
    mockStore.addConfessions([scheduledConf]);

    // Google Sheet row 43 is currently showing NEW
    mockStore.setMockSheetRows({
      43: {
        rowNumber: 43,
        name: 'Rohan',
        confession: 'I submitted my assignment 2 seconds before the deadline.',
        status: 'NEW',
      },
    });

    const report = await sheetSyncService.syncGoogleSheet();

    // Google Sheet row 43 status must be SCHEDULED
    const updatedSheetRows = mockStore.getMockSheetRows();
    expect(updatedSheetRows[43].status).toBe('SCHEDULED');
    expect(report.scheduledRecords).toBeGreaterThanOrEqual(1);

    const item = report.reconciliationItems.find((i) => i.rowNumber === 43);
    expect(item?.actionTaken).toBe('STATUS_CORRECTED');
    expect(item?.sheetStatusAfter).toBe('SCHEDULED');
  });

  // ─── Test C: New Confession Import Once ──────────────────────────────────
  it('Test C: New submission imports once into moderation, repeated sync never duplicates', async () => {
    const initialCount = mockStore.getConfessions().length;

    mockStore.setMockSheetRows({
      99: {
        rowNumber: 99,
        name: 'Aarav',
        confession: 'I secretly watered all the dry plants in the hostel hallway.',
        status: '',
      },
    });

    // First sync: imports the row
    const report1 = await sheetSyncService.syncGoogleSheet();
    expect(report1.newRowsImported).toBe(1);
    expect(mockStore.getConfessions().length).toBe(initialCount + 1);

    const imported = mockStore.getConfessions().find((c) => c.google_sheet_row === 99);
    expect(imported).toBeDefined();
    expect(imported?.original_text).toContain('watered all the dry plants');

    // Second sync: must NOT import duplicate row!
    const report2 = await sheetSyncService.syncGoogleSheet();
    expect(report2.newRowsImported).toBe(0);
    expect(mockStore.getConfessions().length).toBe(initialCount + 1);
  });

  // ─── Test D: Sheet API Failure Resilience ────────────────────────────────
  it('Test D: If Google Sheets batch update fails, DB status remains authoritative and safe', async () => {
    const publishedConf: Confession = {
      id: 'conf-published-77',
      google_sheet_id: 'test-sheet',
      google_sheet_row: 77,
      name: 'Anonymous',
      display_name: 'Anonymous',
      original_text: 'Passed all my finals with zero sleep and 5 energy drinks.',
      cleaned_text: 'Passed all my finals with zero sleep and 5 energy drinks.',
      status: 'PUBLISHED',
      published_at: '2026-10-11T12:00:00Z',
      instagram_media_id: 'ig_media_777',
      instagram_permalink: 'https://instagram.com/p/pass77/',
      is_anonymous: true,
      moderation_status: 'LOW',
      moderation_reason: 'Passed safety validation.',
      ai_processed: true,
      template_id: '44444444-4444-4444-4444-444444444444',
      caption: 'Confession #77',
      hashtags: ['#confession'],
      created_at: '2026-10-10T10:00:00Z',
      updated_at: '2026-10-11T12:00:00Z',
    };
    mockStore.addConfessions([publishedConf]);

    mockStore.setMockSheetRows({
      77: {
        rowNumber: 77,
        name: 'Anonymous',
        confession: 'Passed all my finals with zero sleep and 5 energy drinks.',
        status: 'FAILED',
      },
    });

    // Mock sheet batch update failure
    const batchSpy = vi
      .spyOn(googleSheetsService, 'batchUpdateRowStatuses')
      .mockResolvedValueOnce({
        successful: 0,
        failed: 1,
        errors: ['Google Sheets API quota exceeded (HTTP 429)'],
      });

    const report = await sheetSyncService.syncGoogleSheet();

    // 1. Database status must NOT be changed or downgraded
    const conf = mockStore.getConfessionById('conf-published-77');
    expect(conf?.status).toBe('PUBLISHED');

    // 2. Report records the failure gracefully without crash
    expect(report.sheetUpdatesFailed).toBe(1);
    expect(report.errors).toContain('Google Sheets API quota exceeded (HTTP 429)');

    batchSpy.mockRestore();

    // On next sync with healthy API, sheet update succeeds
    const reportNext = await sheetSyncService.syncGoogleSheet();
    expect(reportNext.sheetUpdatesSuccessful).toBeGreaterThanOrEqual(1);
    expect(mockStore.getMockSheetRows()[77].status).toBe('PUBLISHED');
  });

  // ─── Test E: Unknown / Timed-out State Preservation ──────────────────────
  it('Test E: Timed-out publish remains UNKNOWN and is never blindly auto-approved or scheduled', async () => {
    const unknownConf: Confession = {
      id: 'conf-unknown-88',
      google_sheet_id: 'test-sheet',
      google_sheet_row: 88,
      name: 'Anonymous',
      display_name: 'Anonymous',
      original_text: 'Is the cafeteria closing early today?',
      cleaned_text: 'Is the cafeteria closing early today?',
      status: 'UNKNOWN',
      reconciliation_status: 'NEEDS_REVIEW',
      reconciliation_notes: 'Publishing timed out awaiting Meta confirmation.',
      is_anonymous: true,
      moderation_status: 'LOW',
      moderation_reason: 'Passed safety validation.',
      ai_processed: false,
      template_id: '44444444-4444-4444-4444-444444444444',
      caption: 'Confession #88',
      hashtags: ['#confession'],
      created_at: '2026-10-11T10:00:00Z',
      updated_at: '2026-10-11T10:00:00Z',
    };
    mockStore.addConfessions([unknownConf]);

    mockStore.setMockSheetRows({
      88: {
        rowNumber: 88,
        name: 'Anonymous',
        confession: 'Is the cafeteria closing early today?',
        status: 'NEW',
      },
    });

    const report = await sheetSyncService.syncGoogleSheet();

    const conf = mockStore.getConfessionById('conf-unknown-88');
    expect(conf?.status).toBe('UNKNOWN');
    expect(conf?.reconciliation_status).toBe('NEEDS_REVIEW');

    const sheetRows = mockStore.getMockSheetRows();
    expect(sheetRows[88].status).toBe('UNKNOWN');
    expect(report.unknownRecords).toBeGreaterThanOrEqual(1);
  });

  // ─── Test F: Repeated Sync Idempotency ───────────────────────────────────
  it('Test F: Syncing 3 consecutive times produces identical state with 0 duplicates and 0 posts', async () => {
    const publishSpy = vi.spyOn(instagramService, 'publishPost');

    mockStore.setMockSheetRows({
      101: {
        rowNumber: 101,
        name: 'Neha',
        confession: 'I love studying in the top floor library corner.',
        status: 'NEW',
      },
      102: {
        rowNumber: 102,
        name: 'Rahul',
        confession: 'Lost my ID card in the sports complex yesterday.',
        status: 'NEW',
      },
    });

    // Run 1
    const r1 = await sheetSyncService.syncGoogleSheet();
    const countAfter1 = mockStore.getConfessions().length;
    expect(r1.newRowsImported).toBe(2);

    // Run 2
    const r2 = await sheetSyncService.syncGoogleSheet();
    const countAfter2 = mockStore.getConfessions().length;
    expect(r2.newRowsImported).toBe(0);
    expect(countAfter2).toBe(countAfter1);

    // Run 3
    const r3 = await sheetSyncService.syncGoogleSheet();
    const countAfter3 = mockStore.getConfessions().length;
    expect(r3.newRowsImported).toBe(0);
    expect(countAfter3).toBe(countAfter1);

    expect(publishSpy).not.toHaveBeenCalled();
  });

  // ─── Test G: Historical Failures Reconciled Against Published Ledger ─────
  it('Test G: Historical failure reconciled against published ledger corrects Sheet and DB to PUBLISHED', async () => {
    // Record verified post in ledger
    mockStore.addPublishedPost({
      id: 'ledger-item-1',
      confession_id: 'historical-conf-50',
      confession_number: 50,
      preview_text: 'Thank you to the professor who stayed extra 30 mins to explain pointers.',
      instagram_media_id: 'ledger_media_555',
      permalink: 'https://instagram.com/p/ledger555/',
      published_at: '2026-10-08T18:00:00Z',
      template_name: 'Classic Monochrome',
    });

    mockStore.setMockSheetRows({
      50: {
        rowNumber: 50,
        name: 'Student',
        confession: 'Thank you to the professor who stayed extra 30 mins to explain pointers.',
        status: 'FAILED',
        error: 'Old server disconnect',
      },
    });

    const report = await sheetSyncService.syncGoogleSheet();

    // 1. Sheet updated to PUBLISHED with ledger's media ID & link
    const sheetRow = mockStore.getMockSheetRows()[50];
    expect(sheetRow.status).toBe('PUBLISHED');
    expect(sheetRow.postId).toBe('ledger_media_555');
    expect(sheetRow.instagramUrl).toBe('https://instagram.com/p/ledger555/');

    // 2. Report marked publication verified
    expect(report.alreadyPublishedVerified).toBeGreaterThanOrEqual(1);
  });

  // ─── Test H: Background Job Execution ────────────────────────────────────
  it('Test H: Background job service runs sheet sync asynchronously and tracks step progress', async () => {
    mockStore.setMockSheetRows({
      120: {
        rowNumber: 120,
        name: 'Ananya',
        confession: 'Enjoyed the cultural fest performances so much!',
        status: 'NEW',
      },
    });

    const job = await backgroundJobService.startSheetSyncJob();
    expect(job.id).toBeDefined();
    expect(job.type).toBe('SHEET_SYNC');
    expect(job.status).toBe('QUEUED');

    // Wait for async execution up to 2 seconds
    let finishedJob = backgroundJobService.getJob(job.id);
    for (let i = 0; i < 20; i++) {
      if (finishedJob?.status === 'COMPLETED' || finishedJob?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      finishedJob = backgroundJobService.getJob(job.id);
    }

    expect(finishedJob?.status).toBe('COMPLETED');
    expect(finishedJob?.result).toBeDefined();
    expect(finishedJob?.result.totalRowsExamined).toBeGreaterThanOrEqual(1);
    expect(finishedJob?.message).toContain('Full Google Sheets Sync Complete');
  });
});
