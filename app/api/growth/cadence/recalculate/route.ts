import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { backgroundJobService } from '@/services/backgroundJobService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const job = await backgroundJobService.startRecalculateScheduleJob();

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Schedule recalculation started in background.',
      job,
    }, { status: 202 });
  } catch (err: any) {
    console.error('[API Cadence Recalculate] Failed to start schedule recalculation:', err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SCHEDULE_RECALCULATION_FAILED',
          message: err?.message || 'Failed to start schedule recalculation',
        },
      },
      { status: err?.message?.includes('already in progress') ? 409 : 500 }
    );
  }
}
