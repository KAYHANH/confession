import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const hooks = await growthMetricsService.getHookPerformanceStats();
    return NextResponse.json({
      success: true,
      data: hooks,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch hook performance' },
      { status: 500 }
    );
  }
}
