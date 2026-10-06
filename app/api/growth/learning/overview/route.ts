import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const [
      summary,
      categoryStats,
      formatStats,
      timeStats,
      gapStats,
      densityStats,
      combinationStats,
      recencyTrends,
    ] = await Promise.all([
      growthMetricsService.getAccountLearningSummary(),
      growthMetricsService.getCategoryGrowthAnalysis(),
      growthMetricsService.getFormatDetailedAnalysis(),
      growthMetricsService.getDetailedTimeSlotAnalysis(),
      growthMetricsService.getDetailedPostGapAnalysis(),
      growthMetricsService.getPostDensityAnalysis(),
      growthMetricsService.getCombinationAnalysis(),
      growthMetricsService.getRecencyTrends(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        summary,
        categoryStats,
        formatStats,
        timeStats,
        gapStats,
        densityStats,
        combinationStats,
        recencyTrends,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch account learning overview' },
      { status: 500 }
    );
  }
}
