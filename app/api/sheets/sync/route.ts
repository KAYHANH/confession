import { NextResponse } from 'next/server';
import { schedulingService } from '@/services/schedulingService';

export async function POST() {
  try {
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
