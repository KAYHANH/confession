import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const categories = await growthMetricsService.getCategoryGrowthStats();
    return NextResponse.json({
      success: true,
      data: categories,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch category stats' },
      { status: 500 }
    );
  }
}
