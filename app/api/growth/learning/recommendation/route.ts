import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthSchedulingAgent } from '@/services/growth/growthSchedulingAgent';
import { scheduleValidationService } from '@/services/growth/scheduleValidationService';
import { recommendationLearningService } from '@/services/growth/recommendationLearningService';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    // 1. Fetch next eligible approved confession if available
    const allConfessions = mockStore.getConfessions();
    const nextApproved = allConfessions.find((c) => c.status === 'APPROVED' && !c.scheduled_at);

    // 2. Generate recommendation
    const recommendation = await growthSchedulingAgent.getNextSchedulingRecommendation();

    // 3. Run deterministic validation against admin boundaries and platform safety
    const validation = await scheduleValidationService.validateAndApplySafetyRules(
      recommendation,
      nextApproved
    );

    // 4. Log recommendation
    const record = await recommendationLearningService.logRecommendation(
      recommendation,
      validation,
      nextApproved
    );

    return NextResponse.json({
      success: true,
      data: {
        recordId: record.id,
        recommendation,
        validation,
        targetConfession: nextApproved
          ? {
              id: nextApproved.id,
              row: nextApproved.google_sheet_row,
              text: (nextApproved.cleaned_text || nextApproved.original_text || '').slice(0, 100),
            }
          : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate recommendation' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const allConfessions = mockStore.getConfessions();
    const targetConfession = body.confessionId
      ? mockStore.getConfessionById(body.confessionId)
      : allConfessions.find((c) => c.status === 'APPROVED' && !c.scheduled_at);

    const recommendation = await growthSchedulingAgent.getNextSchedulingRecommendation({
      forceBaseline: body.forceBaseline === true,
    });

    const validation = await scheduleValidationService.validateAndApplySafetyRules(
      recommendation,
      targetConfession || undefined
    );

    const record = await recommendationLearningService.logRecommendation(
      recommendation,
      validation,
      targetConfession || undefined
    );

    return NextResponse.json({
      success: true,
      data: {
        recordId: record.id,
        recommendation,
        validation,
        targetConfession: targetConfession
          ? {
              id: targetConfession.id,
              row: targetConfession.google_sheet_row,
              text: (targetConfession.cleaned_text || targetConfession.original_text || '').slice(0, 100),
            }
          : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to process recommendation request' },
      { status: 500 }
    );
  }
}
