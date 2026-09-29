import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const formats = await growthMetricsService.getFormatComparison();
    return NextResponse.json({
      success: true,
      data: formats,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch format comparisons' },
      { status: 500 }
    );
  }
}
