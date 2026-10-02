import { NextRequest, NextResponse } from 'next/server';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { growthAnalysisService } from '@/services/growth/growthAnalysisService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await Promise.resolve(props.params);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Post ID missing' }, { status: 400 });
    }

    const postGrowth = await growthMetricsService.getPostGrowthAnalysis(id);
    if (!postGrowth) {
      return NextResponse.json({ success: false, error: 'Post growth record not found' }, { status: 404 });
    }

    // Generate AI post-mortem based on real measured metrics
    const postMortem = await growthAnalysisService.analyzePostMortem(id);
    postGrowth.ai_post_mortem = postMortem;

    return NextResponse.json({
      success: true,
      data: postGrowth,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch post diagnostics' },
      { status: 500 }
    );
  }
}
