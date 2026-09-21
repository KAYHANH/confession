import { NextRequest, NextResponse } from 'next/server';
import { googleSheetsService } from '@/services/googleSheetsService';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const currentConfig = mockStore.getGoogleSheetConfig();

    const testConfig = {
      ...currentConfig,
      spreadsheet_id: body.spreadsheetId || currentConfig.spreadsheet_id,
      sheet_name: body.sheetName || currentConfig.sheet_name,
    };

    const result = await googleSheetsService.testConnection(testConfig);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Connection failed' }, { status: 500 });
  }
}
