import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cronAuth';
import { schedulingService } from '@/services/schedulingService';

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing CRON_SECRET' }, { status: 401 });
  }

  try {
    const result = await schedulingService.processDuePosts();
    return NextResponse.json({
      success: true,
      message: `Cron publisher finished. ${result.published.length} post(s) published.`,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Cron publishing failed' }, { status: 500 });
  }
}
