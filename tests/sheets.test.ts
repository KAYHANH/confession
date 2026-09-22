import { describe, it, expect } from 'vitest';
import { googleSheetsService } from '../services/googleSheetsService';

describe('GoogleSheetsService Column Mapping & Deduplication', () => {
  it('should correctly convert column letters to 0-based indices', () => {
    expect(googleSheetsService.columnLetterToIndex('A')).toBe(0);
    expect(googleSheetsService.columnLetterToIndex('B')).toBe(1);
    expect(googleSheetsService.columnLetterToIndex('C')).toBe(2);
    expect(googleSheetsService.columnLetterToIndex('Z')).toBe(25);
    expect(googleSheetsService.columnLetterToIndex('AA')).toBe(26);
    expect(googleSheetsService.columnLetterToIndex('AB')).toBe(27);
  });

  it('should correctly convert indices to column letters', () => {
    expect(googleSheetsService.indexToColumnLetter(0)).toBe('A');
    expect(googleSheetsService.indexToColumnLetter(1)).toBe('B');
    expect(googleSheetsService.indexToColumnLetter(25)).toBe('Z');
    expect(googleSheetsService.indexToColumnLetter(26)).toBe('AA');
    expect(googleSheetsService.indexToColumnLetter(27)).toBe('AB');
  });

  it('should return error when spreadsheet ID is empty or not connected', async () => {
    const res = await googleSheetsService.testConnection({
      spreadsheet_id: '',
      sheet_name: 'Confessions',
      column_mapping: {
        timestampColumn: 'A',
        nameColumn: 'B',
        confessionColumn: 'C',
        statusColumn: 'D',
        postIdColumn: 'E',
        instagramUrlColumn: 'F',
        processedAtColumn: 'G',
        errorColumn: 'H',
      },
    });

    expect(res.success).toBe(false);
    expect(res.message).toContain('No Google Sheet connected');
  });
});
