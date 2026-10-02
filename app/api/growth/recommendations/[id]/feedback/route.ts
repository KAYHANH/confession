import { NextRequest, NextResponse } from 'next/server';
import { growthRecommendationService } from '@/services/growth/growthRecommendationService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await Promise.resolve(props.params);
    const body = await request.json();
    const { action, feedbackNotes } = body;

    if (!action || !['ACCEPTED', 'REJECTED', 'IGNORED', 'OVERRIDDEN'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Valid action (ACCEPTED, REJECTED, IGNORED, OVERRIDDEN) is required' },
        { status: 400 }
      );
    }

    const recorded = await growthRecommendationService.recordFeedback(id, action, feedbackNotes);

    return NextResponse.json({
      success: true,
      data: recorded,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to record feedback' },
      { status: 500 }
    );
  }
}
