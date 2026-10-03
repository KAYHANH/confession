import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cadenceAnalyzer } from '@/services/growth/cadenceAnalyzer';
import { schedulingService } from '@/services/schedulingService';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const recommendation = await cadenceAnalyzer.getCadenceRecommendation();
    const diagnostics = await schedulingService.getQueueDiagnostics();

    return NextResponse.json({
      success: true,
      recommendation,
      diagnostics,
    });
  } catch (err: any) {
    console.error('[API Cadence] Failed to fetch cadence recommendation:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch cadence recommendation' },
      { status: 500 }
    );
  }
}
