import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { recommendationLearningService } from '@/services/growth/recommendationLearningService';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { recordId, confessionId, scheduledTime } = body;

    if (!recordId) {
      return NextResponse.json(
        { success: false, error: 'recordId is required' },
        { status: 400 }
      );
    }

    const updatedRec = await recommendationLearningService.acceptRecommendation(recordId);

    // If confessionId and scheduledTime provided, update confession's schedule
    if (confessionId && scheduledTime) {
      const confession = mockStore.getConfessionById(confessionId);
      if (confession) {
        mockStore.updateConfession(confessionId, {
          status: 'SCHEDULED',
          scheduled_at: scheduledTime,
        });

        mockStore.addLog({
          action: 'SCHEDULED',
          entity_type: 'confession',
          entity_id: confessionId,
          metadata: {
            scheduled_at: scheduledTime,
            accepted_recommendation_id: recordId,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedRec,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to accept recommendation' },
      { status: 500 }
    );
  }
}
