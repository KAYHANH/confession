import { google } from 'googleapis';
import { ColumnMapping, GoogleSheetConfig, Confession } from '@/types';
import { mockStore } from '@/lib/mockStore';

export interface RawSheetRow {
  rowNumber: number;
  timestamp: string;
  name: string;
  confession: string;
  status: string;
  isAnonymous?: boolean;
  className?: string;
  postId?: string;
  instagramUrl?: string;
  processedAt?: string;
  error?: string;
}

export interface SyncStats {
  totalRowsRead: number;
  newRowsImported: number;
  alreadyImported: number;
  skippedEmpty: number;
  importedConfessions: Confession[];
}

export class GoogleSheetsService {
  /**
   * Converts a column letter ('A', 'B', 'Z', 'AA', etc.) to 0-based column index
   */
  public columnLetterToIndex(letter: string): number {
    const clean = (letter || 'A').toUpperCase().trim();
    let index = 0;
    for (let i = 0; i < clean.length; i++) {
      index = index * 26 + (clean.charCodeAt(i) - 64);
    }
    return Math.max(0, index - 1);
  }

  /**
   * Converts a 0-based column index to column letter (0 -> 'A', 25 -> 'Z', 26 -> 'AA')
   */
  public indexToColumnLetter(index: number): string {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - mod) / 26);
    }
    return letter;
  }

  /**
   * Get an authorized Google Sheets client or return null if using mock/unconfigured
   */
  private getClient() {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!email || !rawKey || process.env.MOCK_EXTERNAL_APIS === 'true') {
      return null;
    }

    try {
      const privateKey = rawKey.replace(/\\n/g, '\n');
      const auth = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      return google.sheets({ version: 'v4', auth });
    } catch (e) {
      console.warn('[GoogleSheetsService] Failed to initialize Google Auth client:', e);
      return null;
    }
  }

  /**
   * Sanitizes spreadsheet ID or extracts it from a full Google Sheets URL
   */
  public sanitizeSpreadsheetId(input: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    return trimmed;
  }

  /**
   * RFC 4180-compliant CSV parser that handles quotes and newlines
   */
  public parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentVal = '';
    let insideQuote = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuote && nextChar === '"') {
          currentVal += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        currentRow.push(currentVal);
        currentVal = '';
      } else if ((char === '\r' || char === '\n') && !insideQuote) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentVal);
        currentVal = '';
        if (currentRow.length > 0 && currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentVal += char;
      }
    }

    if (currentVal || currentRow.length > 0) {
      currentRow.push(currentVal);
      if (currentRow.some((c) => c.trim().length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  /**
   * Automatically resolves column indices from header row with smart detection
   */
  public resolveColumnIndices(headerRow: string[], configMapping: ColumnMapping) {
    let colTime = this.columnLetterToIndex(configMapping.timestampColumn || 'A');
    let colName = this.columnLetterToIndex(configMapping.nameColumn || 'B');
    let colConf = this.columnLetterToIndex(configMapping.confessionColumn || 'E');
    let colStatus = this.columnLetterToIndex(configMapping.statusColumn || 'D');
    let colPostId = this.columnLetterToIndex(configMapping.postIdColumn || 'E');
    let colUrl = this.columnLetterToIndex(configMapping.instagramUrlColumn || 'F');
    let colProcAt = this.columnLetterToIndex(configMapping.processedAtColumn || 'G');
    let colErr = this.columnLetterToIndex(configMapping.errorColumn || 'H');
    let colDisclose: number | null = null;
    let colClass: number | null = null;

    if (headerRow && headerRow.length > 0) {
      headerRow.forEach((hdr, idx) => {
        const lower = (hdr || '').toLowerCase().trim();
        if (lower.includes('confession') || lower.includes('confess') || lower.includes('secret') || lower.includes('message')) {
          colConf = idx;
        } else if (lower.includes('timestamp') || lower.includes('date')) {
          colTime = idx;
        } else if (lower.includes('disclose') || lower.includes('anonymous')) {
          colDisclose = idx;
        } else if (lower.includes('class') || lower.includes('grade') || lower.includes('branch')) {
          colClass = idx;
        } else if (lower.includes('name') && !lower.includes('disclose')) {
          colName = idx;
        }
      });

      // Avoid bug where confessionColumn was mapped to a YES/NO question column
      if (headerRow[colConf]) {
        const selectedColHdr = headerRow[colConf].toLowerCase();
        if (selectedColHdr.includes('disclose') || selectedColHdr.includes('anonymous')) {
          const actualConfIdx = headerRow.findIndex((h) => (h || '').toLowerCase().includes('confession'));
          if (actualConfIdx !== -1) {
            colDisclose = colConf;
            colConf = actualConfIdx;
          }
        }
      }
    }

    return { colTime, colName, colConf, colStatus, colPostId, colUrl, colProcAt, colErr, colDisclose, colClass };
  }

  /**
   * Fetch rows directly from public link-shared Google Sheet CSV export
   */
  public async fetchRowsFromPublicSheet(config: GoogleSheetConfig): Promise<RawSheetRow[]> {
    const spreadsheetId = this.sanitizeSpreadsheetId(config.spreadsheet_id);
    const sheetName = config.sheet_name || 'Sheet1';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

    const res = await fetch(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch sheet (HTTP ${res.status}). Please verify that sheet link sharing is set to "Anyone with the link can view".`);
    }

    const text = await res.text();
    if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error(
        'Google Sheet is private. Please open your Google Sheet, click "Share", and set General Access to "Anyone with the link can view", OR configure a Google Service Account in .env.local.'
      );
    }

    const parsedRows = this.parseCSV(text);
    if (parsedRows.length <= 1) {
      return [];
    }

    const {
      colTime,
      colName,
      colConf,
      colStatus,
      colPostId,
      colUrl,
      colProcAt,
      colErr,
      colDisclose,
      colClass,
    } = this.resolveColumnIndices(parsedRows[0] || [], config.column_mapping);

    const rows: RawSheetRow[] = [];

    parsedRows.slice(1).forEach((row, i) => {
      const rowNumber = i + 2;
      const confessionText = (row[colConf] || '').trim();
      if (!confessionText) return;

      const rawName = (row[colName] || '').trim();
      const discloseAnswer = colDisclose !== null ? (row[colDisclose] || '').trim().toUpperCase() : null;
      const classInfo = colClass !== null ? (row[colClass] || '').trim() : '';

      let isAnonymous = true;
      let finalName = 'Anonymous';

      if (discloseAnswer === 'YES') {
        isAnonymous = false;
        finalName = rawName || 'Student';
      } else if (discloseAnswer === 'NO') {
        isAnonymous = true;
        finalName = 'Anonymous';
      } else if (rawName && rawName.toLowerCase() !== 'anonymous') {
        isAnonymous = false;
        finalName = rawName;
      }

      rows.push({
        rowNumber,
        timestamp: (row[colTime] || new Date().toISOString()).trim(),
        name: finalName,
        confession: confessionText,
        status: (row[colStatus] || 'NEW').trim(),
        isAnonymous,
        className: classInfo,
        postId: row[colPostId]?.trim(),
        instagramUrl: row[colUrl]?.trim(),
        processedAt: row[colProcAt]?.trim(),
        error: row[colErr]?.trim(),
      });
    });

    return rows;
  }

  /**
   * Fetch rows from the sheet using custom column mapping
   */
  public async fetchRows(config: GoogleSheetConfig): Promise<RawSheetRow[]> {
    const client = this.getClient();

    if (client) {
      try {
        const spreadsheetId = this.sanitizeSpreadsheetId(config.spreadsheet_id);
        const { sheet_name, column_mapping } = config;
        const response = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheet_name}'!A1:Z`, // Include header row 1 to auto-resolve columns
        });

        const allValues = response.data.values || [];
        if (allValues.length <= 1) return [];

        const headerRow = (allValues[0] || []).map((v) => (v || '').toString());
        const {
          colTime,
          colName,
          colConf,
          colStatus,
          colPostId,
          colUrl,
          colProcAt,
          colErr,
          colDisclose,
          colClass,
        } = this.resolveColumnIndices(headerRow, column_mapping);

        const rows: RawSheetRow[] = [];

        allValues.slice(1).forEach((row, i) => {
          const rowNumber = i + 2;
          const text = (row[colConf] || '').toString().trim();
          if (!text) return;

          const rawName = (row[colName] || '').toString().trim();
          const discloseAnswer = colDisclose !== null ? (row[colDisclose] || '').toString().trim().toUpperCase() : null;
          const classInfo = colClass !== null ? (row[colClass] || '').toString().trim() : '';

          let isAnonymous = true;
          let finalName = 'Anonymous';

          if (discloseAnswer === 'YES') {
            isAnonymous = false;
            finalName = rawName || 'Student';
          } else if (discloseAnswer === 'NO') {
            isAnonymous = true;
            finalName = 'Anonymous';
          } else if (rawName && rawName.toLowerCase() !== 'anonymous') {
            isAnonymous = false;
            finalName = rawName;
          }

          rows.push({
            rowNumber,
            timestamp: (row[colTime] || new Date().toISOString()).toString(),
            name: finalName,
            confession: text,
            status: (row[colStatus] || 'NEW').toString().trim(),
            isAnonymous,
            className: classInfo,
            postId: row[colPostId]?.toString(),
            instagramUrl: row[colUrl]?.toString(),
            processedAt: row[colProcAt]?.toString(),
            error: row[colErr]?.toString(),
          });
        });

        return rows;
      } catch (error: any) {
        console.error('[GoogleSheetsService] Error fetching rows from Google Sheets API client:', error?.message || error);
        throw new Error(`Google Sheets API Error: ${error?.message || 'Failed to read spreadsheet'}`);
      }
    }

    // Client not configured: check if a real spreadsheet_id is provided
    const spreadsheetId = this.sanitizeSpreadsheetId(config.spreadsheet_id);
    if (spreadsheetId && !spreadsheetId.startsWith('mock')) {
      try {
        const publicRows = await this.fetchRowsFromPublicSheet(config);
        return publicRows;
      } catch (err: any) {
        console.warn('[GoogleSheetsService] Public sheet fetch failed:', err?.message || err);
        throw new Error(err?.message || 'Failed to fetch from Google Sheet');
      }
    }

    // If mock mode is explicitly enabled, return simulated rows
    if (process.env.MOCK_EXTERNAL_APIS === 'true') {
      return this.getMockRows(config);
    }

    throw new Error('No Google Sheet connected. Please enter your Google Sheet URL or ID in Settings -> Google Sheets.');
  }

  /**
   * Update a specific row in the Google Sheet (e.g. after approval, publish, failure)
   */
  public async updateRowStatus(
    config: GoogleSheetConfig,
    rowNumber: number,
    updates: {
      status: string;
      postId?: string;
      instagramUrl?: string;
      processedAt?: string;
      error?: string;
    }
  ): Promise<boolean> {
    const client = this.getClient();

    if (!client) {
      console.log(`[GoogleSheetsService Mock] Updated Row ${rowNumber} status -> ${updates.status}`);
      return true;
    }

    try {
      const { spreadsheet_id, sheet_name, column_mapping } = config;
      const dataToUpdate: { range: string; values: any[][] }[] = [];

      if (column_mapping.statusColumn) {
        dataToUpdate.push({
          range: `'${sheet_name}'!${column_mapping.statusColumn}${rowNumber}`,
          values: [[updates.status]],
        });
      }
      if (updates.postId && column_mapping.postIdColumn) {
        dataToUpdate.push({
          range: `'${sheet_name}'!${column_mapping.postIdColumn}${rowNumber}`,
          values: [[updates.postId]],
        });
      }
      if (updates.instagramUrl && column_mapping.instagramUrlColumn) {
        dataToUpdate.push({
          range: `'${sheet_name}'!${column_mapping.instagramUrlColumn}${rowNumber}`,
          values: [[updates.instagramUrl]],
        });
      }
      if (updates.processedAt && column_mapping.processedAtColumn) {
        dataToUpdate.push({
          range: `'${sheet_name}'!${column_mapping.processedAtColumn}${rowNumber}`,
          values: [[updates.processedAt]],
        });
      }
      if (updates.error !== undefined && column_mapping.errorColumn) {
        dataToUpdate.push({
          range: `'${sheet_name}'!${column_mapping.errorColumn}${rowNumber}`,
          values: [[updates.error || '']],
        });
      }

      if (dataToUpdate.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId: spreadsheet_id,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: dataToUpdate,
          },
        });
      }

      return true;
    } catch (err: any) {
      console.error(`[GoogleSheetsService] Failed to update row ${rowNumber}:`, err?.message || err);
      return false;
    }
  }

  /**
   * Test connection to Google Sheet
   */
  public async testConnection(config: GoogleSheetConfig): Promise<{ success: boolean; message: string; title?: string }> {
    const client = this.getClient();
    const spreadsheetId = this.sanitizeSpreadsheetId(config.spreadsheet_id);

    if (client) {
      try {
        const resp = await client.spreadsheets.get({
          spreadsheetId,
        });

        const title = resp.data.properties?.title || 'Connected Sheet';
        const sheets = resp.data.sheets?.map((s) => s.properties?.title) || [];
        
        if (!sheets.includes(config.sheet_name)) {
          return {
            success: false,
            message: `Connected to spreadsheet "${title}", but sheet tab "${config.sheet_name}" was not found. Available tabs: ${sheets.join(', ')}`,
          };
        }

        return {
          success: true,
          message: `Successfully connected to "${title}" (Sheet: "${config.sheet_name}") via Google Service Account!`,
          title,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Connection failed: ${err?.message || 'Invalid Spreadsheet ID or permissions'}`,
        };
      }
    }

    // No Service Account: Check if user provided a real Google Sheet ID
    if (spreadsheetId && !spreadsheetId.startsWith('mock')) {
      try {
        const rows = await this.fetchRowsFromPublicSheet(config);
        return {
          success: true,
          message: `Connected to Google Sheet via Link Sharing! Found ${rows.length} confession row(s). (Note: To enable writing status updates back to your sheet, add Service Account credentials in .env.local).`,
          title: `Google Sheet (${config.sheet_name})`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: err?.message || 'Could not connect to Google Sheet',
        };
      }
    }

    return {
      success: true,
      message: 'Mock Mode Active: Google Sheet simulated with 6 demo confessions. To connect your real sheet, enter your Spreadsheet ID above.',
      title: 'Demo University Confessions (Mock)',
    };
  }

  /**
   * Mock rows provider for offline local development
   */
  private getMockRows(config: GoogleSheetConfig): RawSheetRow[] {
    const existing = mockStore.getConfessions();
    const maxRow = existing.reduce((max, c) => Math.max(max, c.google_sheet_row), 1);

    return [
      {
        rowNumber: 2,
        timestamp: '2026-09-20 10:14:22',
        name: 'Rahul',
        confession: 'I have liked my best friend for two years but never told her. Every time she talks about someone else my heart breaks a little.',
        status: 'IMPORTED',
      },
      {
        rowNumber: 3,
        timestamp: '2026-09-20 11:32:05',
        name: 'Anonymous',
        confession: 'I accidentally replied to my professor on email instead of my friend saying "this guy never stops giving homework bro send help". He replied with "Noted, extra assignment for you on Monday".',
        status: 'IMPORTED',
      },
      {
        rowNumber: 4,
        timestamp: '2026-09-20 14:05:51',
        name: 'Pooja',
        confession: 'My roommate keeps stealing my expensive coffee so I switched the coffee powder with decaf and cheap chicory. She hasn\'t noticed yet and thinks the brand lost quality haha.',
        status: 'SCHEDULED',
      },
      {
        rowNumber: 5,
        timestamp: '2026-09-21 08:20:10',
        name: 'Anonymous',
        confession: 'Call me at 9876543210 if you want to know what actually happened at the farewell party with Priya from CSE branch.',
        status: 'IMPORTED',
      },
      // Additional new mock submission simulating fresh row
      {
        rowNumber: maxRow + 1,
        timestamp: new Date().toISOString(),
        name: 'Aman S.',
        confession: 'During the mid-term exams, our entire back row had a code word system using pen clicks. Got an A in Data Structures because of teamwork!',
        status: 'NEW',
      },
      {
        rowNumber: maxRow + 2,
        timestamp: new Date().toISOString(),
        name: 'Simran',
        confession: 'I secretly leave sticky notes with motivational quotes on random lockers in the library every Friday night. Seeing someone smile reading one made my whole semester.',
        status: 'NEW',
      },
    ];
  }
}

export const googleSheetsService = new GoogleSheetsService();
