import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { schedulingService } from '@/services/schedulingService';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await schedulingService.repairStaleQueue();
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    console.error('[API Cadence Repair] Failed to repair stale queue:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to repair stale queue' },
      { status: 500 }
    );
  }
}
