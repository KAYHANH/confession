import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const gaps = await growthMetricsService.getPostGapAnalysis();
    return NextResponse.json({
      success: true,
      data: gaps,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch gap analysis' },
      { status: 500 }
    );
  }
}
