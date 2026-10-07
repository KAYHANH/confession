import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { growthDecisionEngine } from '@/services/growth/growthDecisionEngine';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    let candidateOverride = undefined;
    try {
      const body = await request.json();
      if (body.confessionId) {
        candidateOverride = mockStore.getConfessionById(body.confessionId);
      }
    } catch {}

    const decision = await growthDecisionEngine.evaluateNextPost(candidateOverride);

    return NextResponse.json({
      success: true,
      decision,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to evaluate next post decision' },
      { status: 500 }
    );
  }
}
