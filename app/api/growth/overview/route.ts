import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { getSafeGrowthPublicFlags } from '@/lib/growthConfig';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flags = getSafeGrowthPublicFlags();
    const overview = await growthMetricsService.getAccountOverview();

    return NextResponse.json({
      success: true,
      flags,
      data: overview,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch growth overview' },
      { status: 500 }
    );
  }
}
