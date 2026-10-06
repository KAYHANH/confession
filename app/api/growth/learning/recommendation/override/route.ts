import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { recommendationLearningService } from '@/services/growth/recommendationLearningService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { recordId, format, scheduleTime, reason } = body;

    if (!recordId) {
      return NextResponse.json(
        { success: false, error: 'recordId is required' },
        { status: 400 }
      );
    }

    const updatedRec = await recommendationLearningService.overrideRecommendation(recordId, {
      format,
      scheduleTime,
      reason,
    });

    return NextResponse.json({
      success: true,
      data: updatedRec,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to override recommendation' },
      { status: 500 }
    );
  }
}
