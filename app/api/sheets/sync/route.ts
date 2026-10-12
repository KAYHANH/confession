import { NextRequest, NextResponse } from 'next/server';
import { sheetSyncService } from '@/services/sheetSyncService';
import { backgroundJobService } from '@/services/backgroundJobService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const isAsync = url.searchParams.get('async') === 'true' || body.async === true;

    if (isAsync) {
      const job = await backgroundJobService.startSheetSyncJob();
      return NextResponse.json(
        {
          success: true,
          jobId: job.id,
          status: job.status,
          message: 'Google Sheets synchronization started in background.',
          job,
        },
        { status: 202 }
      );
    }

    const report = await sheetSyncService.syncGoogleSheet();
    return NextResponse.json({
      success: true,
      message: `Successfully synced. ${report.newRowsImported} new row(s) imported, ${report.totalRowsExamined} processed.`,
      ...report,
    });
  } catch (error: any) {
    const isConflict = error?.message?.includes('already in progress');
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Sync failed',
      },
      { status: isConflict ? 409 : 500 }
    );
  }
}
