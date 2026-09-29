import { NextResponse } from 'next/server';
import { growthAnalysisService } from '@/services/growth/growthAnalysisService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const analysis = await growthAnalysisService.analyzeAccountGrowth();
    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate growth analysis' },
      { status: 500 }
    );
  }
}
