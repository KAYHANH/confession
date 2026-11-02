import { describe, it, expect, beforeEach } from 'vitest';
import { mockStore } from '@/lib/mockStore';
import { confessionService } from '@/services/confessionService';
import { googleSheetsService } from '@/services/googleSheetsService';
import { sheetSyncService } from '@/services/sheetSyncService';
import { Confession } from '@/types';

describe('Published Visibility & Sheet Sync Fixes', () => {
  beforeEach(() => {
    // Reset mockStore to clean test fixture
    const initialConfessions: Confession[] = [
      {
        id: 'pub-1',
        name: 'Anonymous',
        original_text: 'Published confession 1',
        cleaned_text: 'Published confession 1',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'PUBLISHED',
        caption: 'Confession #002 💭\n\nShare your thoughts below 👇',
        published_at: '2026-10-25T10:00:00.000Z',
        instagram_media_id: '12345',
        instagram_permalink: 'https://instagram.com/p/12345',
        created_at: '2026-10-25T09:00:00.000Z',
        google_sheet_row: undefined, // Simulates cleared sheet row
      },
      {
        id: 'pub-2',
        name: 'Student',
        original_text: 'Published confession 2',
        cleaned_text: 'Published confession 2',
        display_name: 'Student',
        is_anonymous: false,
        status: 'PUBLISHED',
        caption: 'Confession #005 💭\n\nShare your thoughts below 👇',
        published_at: '2026-10-26T12:00:00.000Z',
        instagram_media_id: '67890',
        instagram_permalink: null, // Legacy post without permalink
        created_at: '2026-10-26T11:00:00.000Z',
        google_sheet_row: undefined,
      },
      {
        id: 'del-1',
        name: 'Deleted User',
        original_text: 'Deleted old submission',
        cleaned_text: 'Deleted old submission',
        display_name: 'Deleted User',
        is_anonymous: true,
        status: 'DELETED',
        deleted_at: '2026-10-27T08:00:00.000Z',
        created_at: '2026-10-20T08:00:00.000Z',
        google_sheet_row: 200,
      },
      {
        id: 'active-1',
        name: 'Active User',
        original_text: 'New active submission awaiting review',
        cleaned_text: 'New active submission awaiting review',
        display_name: 'Active User',
        is_anonymous: false,
        status: 'READY_FOR_REVIEW',
        created_at: '2026-10-28T09:00:00.000Z',
        google_sheet_row: 3,
      },
    ];

    mockStore.setConfessions(initialConfessions);
  });

  it('excludes deleted confessions when tab is omitted in getConfessions', async () => {
    const res = await confessionService.getConfessions({ limit: 10 });
    const statuses = res.confessions.map((c) => c.status);
    expect(statuses).not.toContain('DELETED');
    expect(res.confessions.some((c) => c.id === 'del-1')).toBe(false);
    expect(res.confessions.some((c) => c.id === 'active-1')).toBe(true);
    expect(res.confessions.some((c) => c.id === 'pub-1')).toBe(true);
  });

  it('returns published confessions on tab=published regardless of google_sheet_row being undefined', async () => {
    const res = await confessionService.getConfessions({ tab: 'published' });
    expect(res.confessions.length).toBe(2);
    expect(res.confessions.every((c) => c.status === 'PUBLISHED')).toBe(true);
  });

  it('resolves column indices correctly without confusing Post Date for Timestamp or Confession for PostId', () => {
    const headers = [
      'Timestamp',
      'Submitter Name',
      'Anonymous',
      '',
      'Confession Message',
      '',
      'Post Date',
      'Delivery Log',
    ];
    const mapping = {
      timestampColumn: 'A',
      nameColumn: 'B',
      confessionColumn: 'E',
      statusColumn: 'D',
      postIdColumn: 'E',
      instagramUrlColumn: 'F',
      processedAtColumn: 'G',
      errorColumn: 'H',
    };

    const resolved = googleSheetsService.resolveColumnIndices(headers, mapping);

    // Timestamp is Column A (index 0), NOT Post Date (index 6)
    expect(resolved.colTime).toBe(0);
    // Confession is Column E (index 4)
    expect(resolved.colConf).toBe(4);
    // PostId must not collide with Confession column (should be reset to null)
    expect(resolved.colPostId).toBeNull();
  });

  it('unlinks old rejected record at row 2 when a new confession arrives at row 2', async () => {
    // Setup row 2 as previously rejected with "G"
    const rejectedG: Confession = {
      id: 'old-g-row-2',
      name: 'Anonymous',
      original_text: 'G',
      cleaned_text: 'G',
      display_name: 'Anonymous',
      is_anonymous: true,
      status: 'REJECTED',
      quality_status: 'LOW_VALUE',
      google_sheet_row: 2,
      created_at: '2026-10-25T00:00:00.000Z',
    };
    mockStore.setConfessions([rejectedG]);

    // Setup mock sheet with genuine confession at row 2
    mockStore.setMockSheetRows({
      2: {
        timestamp: '2026-10-27 13:54:41',
        name: 'Jumbo gumbo',
        confession: 'Ayan Khan from class 9 told me that he has a crush on Zara Kamran from o level',
        status: 'NEW',
        isAnonymous: false,
      },
    });

    const report = await sheetSyncService.syncGoogleSheet({
      spreadsheet_id: 'mock-sheet-id',
      sheet_name: 'Confessions',
      column_mapping: {
        timestampColumn: 'A',
        nameColumn: 'B',
        confessionColumn: 'E',
        statusColumn: 'D',
        postIdColumn: 'E',
        instagramUrlColumn: 'F',
        processedAtColumn: 'G',
        errorColumn: 'H',
      },
    });

    // Old rejected "G" must be unlinked from row 2
    const oldG = mockStore.getConfessionById('old-g-row-2');
    expect(oldG?.google_sheet_row).toBeUndefined();

    // New confession must be imported at row 2 and be READY_FOR_REVIEW
    const newAtRow2 = mockStore.getConfessions().find((c) => c.google_sheet_row === 2);
    expect(newAtRow2).toBeDefined();
    expect(newAtRow2?.id).not.toBe('old-g-row-2');
    expect(newAtRow2?.original_text).toContain('Ayan Khan');
    expect(newAtRow2?.status).toBe('READY_FOR_REVIEW');
    expect(newAtRow2?.quality_status).not.toBe('LOW_VALUE');
  });
});
