import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const times = await growthMetricsService.getTimeSlotAnalysis();
    return NextResponse.json({
      success: true,
      data: times,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch time slot analysis' },
      { status: 500 }
    );
  }
}
