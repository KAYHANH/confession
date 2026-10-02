import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthAnalysisService } from '@/services/growth/growthAnalysisService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
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
