import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { schedulingService } from '@/services/schedulingService';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
    const result = await adaptiveSchedulingEngine.recalculateFutureQueue();
    const diagnostics = await schedulingService.getQueueDiagnostics();

    return NextResponse.json({
      success: true,
      result,
      diagnostics,
    });
  } catch (err: any) {
    console.error('[API Cadence Recalculate] Failed to recalculate queue schedule:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to recalculate queue schedule' },
      { status: 500 }
    );
  }
}
