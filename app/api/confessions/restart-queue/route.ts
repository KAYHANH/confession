import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { backgroundJobService } from '@/services/backgroundJobService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { ids } = body;

    const targetIds = Array.isArray(ids) && ids.length > 0 ? ids : undefined;

    // Start background job immediately
    const job = await backgroundJobService.startQueueRestartJob({ targetIds });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Queue restart started in background. Posts are being requeued safely without publishing.',
      job,
    }, { status: 202 });
  } catch (error: any) {
    console.error('[RestartQueue] Error starting background queue restart:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'QUEUE_RESTART_FAILED',
          message: error?.message || 'Failed to start queue restart',
        },
      },
      { status: error?.message?.includes('already in progress') ? 409 : 500 }
    );
  }
}
