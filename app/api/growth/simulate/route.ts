import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { backtestSimulationService } from '@/services/growth/backtestSimulationService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    let days = 30;
    try {
      const body = await request.json();
      if (typeof body.days === 'number' && body.days > 0) {
        days = Math.min(90, body.days);
      }
    } catch {}

    const result = await backtestSimulationService.runSimulation(days);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to run growth backtest simulation' },
      { status: 500 }
    );
  }
}
