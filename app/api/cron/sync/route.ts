import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cronAuth';
import { schedulingService } from '@/services/schedulingService';

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing CRON_SECRET' }, { status: 401 });
  }

  try {
    const result = await schedulingService.syncGoogleSheet();
    return NextResponse.json({
      success: true,
      message: 'Cron sync completed successfully',
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Cron sync failed' }, { status: 500 });
  }
}
