import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confessionService } from '../services/confessionService';
import { schedulingService } from '../services/schedulingService';
import { sheetSyncService } from '../services/sheetSyncService';
import { googleSheetsService } from '../services/googleSheetsService';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';
import { generateContentHash } from '../lib/contentHash';

describe('Google Sheet Cleared / All Confessions Deleted & Idle Waiting Safeguards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockStore.setConfessions([]);
    mockStore.setDeletedRowNumbers([]);
    schedulingService.resetState();
    vi.spyOn(googleSheetsService, 'updateRowStatus').mockResolvedValue(true);
    mockStore.updateSettings({
      auto_publish: true,
      publishing_mode: 'AUTO_PUBLISH',
      require_approval: false,
    });
  });

  it('marks all unpublished confessions as DELETED when sheet is cleared (0 rows)', async () => {
    const publishedHash = generateContentHash('Already published confession text');
    const queuedHash1 = generateContentHash('Queued confession 1');
    const scheduledHash = generateContentHash('Scheduled confession 2');

    const initialConfessions: Confession[] = [
      {
        id: 'conf-pub-1',
        google_sheet_row: 2,
        name: 'Alice',
        original_text: 'Already published confession text',
        cleaned_text: 'Already published confession text',
        status: 'PUBLISHED',
        published_at: new Date(Date.now() - 3600000).toISOString(),
        instagram_media_id: 'ig-pub-12345',
        instagram_permalink: 'https://instagram.com/p/test12345/',
        content_hash: publishedHash,
        normalized_content_hash: publishedHash,
        moderation_status: 'LOW',
        is_anonymous: true,
        display_name: 'Anonymous',
        hashtags: [],
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'conf-queued-1',
        google_sheet_row: 3,
        name: 'Bob',
        original_text: 'Queued confession 1',
        cleaned_text: 'Queued confession 1',
        status: 'READY_FOR_REVIEW',
        content_hash: queuedHash1,
        normalized_content_hash: queuedHash1,
        moderation_status: 'LOW',
        is_anonymous: true,
        display_name: 'Anonymous',
        hashtags: [],
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'conf-sched-1',
        google_sheet_row: 4,
        name: 'Charlie',
        original_text: 'Scheduled confession 2',
        cleaned_text: 'Scheduled confession 2',
        status: 'SCHEDULED',
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        content_hash: scheduledHash,
        normalized_content_hash: scheduledHash,
        moderation_status: 'LOW',
        is_anonymous: true,
        display_name: 'Anonymous',
        hashtags: [],
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockStore.setConfessions(initialConfessions);

    // Mock Google Sheet returning 0 rows (sheet completely cleared by user)
    vi.spyOn(googleSheetsService, 'fetchRows').mockResolvedValue([]);

    const report = await sheetSyncService.syncGoogleSheet();

    // The 2 unpublished confessions should be marked DELETED
    expect(report.deletedRecords).toBe(2);

    const afterSync = mockStore.getConfessions();
    const pub = afterSync.find((c) => c.id === 'conf-pub-1')!;
    const queued = afterSync.find((c) => c.id === 'conf-queued-1')!;
    const sched = afterSync.find((c) => c.id === 'conf-sched-1')!;

    // INVARIANT: Published confession MUST remain PUBLISHED!
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.instagram_media_id).toBe('ig-pub-12345');

    // Unpublished confessions must be DELETED and schedule cleared
    expect(queued.status).toBe('DELETED');
    expect(sched.status).toBe('DELETED');
    expect(sched.scheduled_at).toBeNull();
  });

  it('enters idle state with NO_CANDIDATES when all confessions are published or deleted', async () => {
    const pubHash = generateContentHash('Only published remains');
    mockStore.setConfessions([
      {
        id: 'conf-pub-only',
        google_sheet_row: 2,
        name: 'Dave',
        original_text: 'Only published remains',
        cleaned_text: 'Only published remains',
        status: 'PUBLISHED',
        published_at: new Date(Date.now() - 4 * 3600000).toISOString(),
        instagram_media_id: 'ig-only-999',
        content_hash: pubHash,
        normalized_content_hash: pubHash,
        moderation_status: 'LOW',
        is_anonymous: true,
        display_name: 'Anonymous',
        hashtags: [],
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await schedulingService.processAutoPublishCycle();

    expect(result.ran).toBe(false);
    expect(result.status).toBe('NO_CANDIDATES');
    expect(result.reason?.toLowerCase()).toContain('waiting for new submissions from google sheet');

    // Confession must still be PUBLISHED, not reset or re-posted
    const conf = mockStore.getConfessionById('conf-pub-only')!;
    expect(conf.status).toBe('PUBLISHED');
  });

  it('accepts new submission on row 2 after sheet was cleared', async () => {
    // Start with empty sheet state where old row 2 was marked deleted
    mockStore.setConfessions([]);
    mockStore.setDeletedRowNumbers([2]);

    const newConfText = 'This is a brand new incoming confession after sheet reset';
    vi.spyOn(googleSheetsService, 'fetchRows').mockResolvedValue([
      {
        rowNumber: 2,
        timestamp: new Date().toISOString(),
        name: 'Eve',
        confession: newConfText,
        status: '',
      },
    ]);

    const report = await sheetSyncService.syncGoogleSheet();

    expect(report.newRowsImported).toBe(1);
    const confessions = mockStore.getConfessions();
    expect(confessions.length).toBe(1);
    expect(confessions[0].original_text).toBe(newConfText);
    expect(confessions[0].google_sheet_row).toBe(2);
    // Deleted row number 2 should have been un-quarantined for the new submission
    expect(mockStore.getDeletedRowNumbers().has(2)).toBe(false);
  });

  it('rejects re-submitting an already published confession even on a new row', async () => {
    const existingPubText = 'I confessed my love to Emily on Monday';
    const pubHash = generateContentHash(existingPubText);

    mockStore.setConfessions([
      {
        id: 'conf-old-pub',
        google_sheet_row: 2,
        name: 'Frank',
        original_text: existingPubText,
        cleaned_text: existingPubText,
        status: 'PUBLISHED',
        published_at: new Date(Date.now() - 86400000).toISOString(),
        instagram_media_id: 'ig-emily-1',
        content_hash: pubHash,
        normalized_content_hash: pubHash,
        moderation_status: 'LOW',
        is_anonymous: true,
        display_name: 'Anonymous',
        hashtags: [],
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // User pastes the same confession on row 3 in sheet
    vi.spyOn(googleSheetsService, 'fetchRows').mockResolvedValue([
      {
        rowNumber: 3,
        timestamp: new Date().toISOString(),
        name: 'Frank',
        confession: existingPubText,
        status: '',
      },
    ]);

    const report = await sheetSyncService.syncGoogleSheet();

    const all = mockStore.getConfessions();
    const newConf = all.find((c) => c.google_sheet_row === 3)!;
    expect(newConf).toBeDefined();
    // ConfessionFlow identifies it as already published on Instagram and never queues it for upload
    expect(['PUBLISHED', 'DUPLICATE_ALREADY_PUBLISHED']).toContain(newConf.status);
    expect(newConf.status).not.toBe('READY_FOR_REVIEW');
    expect(newConf.status).not.toBe('SCHEDULED');
    expect(newConf.status).not.toBe('APPROVED');
  });
});
