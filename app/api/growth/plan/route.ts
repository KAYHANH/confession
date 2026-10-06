import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cadenceAnalyzer } from '@/services/growth/cadenceAnalyzer';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const dailyPlan = await cadenceAnalyzer.generateDailyGrowthPlan();
    return NextResponse.json({
      success: true,
      dailyPlan,
    });
  } catch (err: any) {
    console.error('[API Growth Plan] Failed to generate daily growth plan:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate daily growth plan' },
      { status: 500 }
    );
  }
}
