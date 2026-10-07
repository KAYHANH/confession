import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthDecisionEngine } from '@/services/growth/growthDecisionEngine';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const forceFresh = searchParams.get('refresh') === 'true';

    const decision = await growthDecisionEngine.getTodayGrowthDecision(forceFresh);

    return NextResponse.json({
      success: true,
      decision,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch growth decision' },
      { status: 500 }
    );
  }
}
