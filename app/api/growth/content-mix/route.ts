import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const [contentMix, formatRecs] = await Promise.all([
      growthMetricsService.getContentMixStrategy(),
      growthMetricsService.getFormatRecommendationByLength(),
    ]);

    return NextResponse.json({
      success: true,
      contentMix,
      formatRecs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch content mix strategy' },
      { status: 500 }
    );
  }
}
