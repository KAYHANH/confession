import { NextRequest, NextResponse } from 'next/server';
import { schedulingService } from '@/services/schedulingService';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const result = await schedulingService.syncGoogleSheet();
    return NextResponse.json({
      success: true,
      message: `Successfully synced. ${result.imported} new row(s) imported, ${result.processed} processed.`,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Sync failed' }, { status: 500 });
  }
}
