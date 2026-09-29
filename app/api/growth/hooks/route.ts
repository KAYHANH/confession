import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const hooks = await growthMetricsService.getHookPerformanceStats();
    return NextResponse.json({
      success: true,
      data: hooks,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch hook performance' },
      { status: 500 }
    );
  }
}
