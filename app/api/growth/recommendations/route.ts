import { NextRequest, NextResponse } from 'next/server';
import { growthStore } from '@/lib/growthStore';
import { growthRecommendationService } from '@/services/growth/growthRecommendationService';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const contentId = url.searchParams.get('contentId') || undefined;

    let recs = await growthStore.getRecommendations(contentId);

    // If a contentId was provided but has no existing recommendation, generate one dynamically
    if (contentId && recs.length === 0) {
      const confession = mockStore.getConfessionById(contentId);
      if (confession) {
        const generated = await growthRecommendationService.generateRecommendation(confession);
        recs = [generated];
      }
    }

    return NextResponse.json({
      success: true,
      data: recs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch recommendations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { confessionId } = body;

    if (!confessionId) {
      return NextResponse.json({ success: false, error: 'confessionId is required' }, { status: 400 });
    }

    const confession = mockStore.getConfessionById(confessionId);
    if (!confession) {
      return NextResponse.json({ success: false, error: 'Confession not found' }, { status: 404 });
    }

    const rec = await growthRecommendationService.generateRecommendation(confession);

    return NextResponse.json({
      success: true,
      data: rec,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate recommendation' },
      { status: 500 }
    );
  }
}
