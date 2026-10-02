import { NextRequest, NextResponse } from 'next/server';
import { reelRenderService } from '@/services/growth/reelRenderService';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { confessionId, animationStyle, hookText, durationMs, ctaText } = body;

    if (!confessionId) {
      return NextResponse.json({ success: false, error: 'confessionId is required' }, { status: 400 });
    }

    const confession = mockStore.getConfessionById(confessionId);
    if (!confession) {
      return NextResponse.json({ success: false, error: 'Confession not found' }, { status: 404 });
    }

    const variant = await reelRenderService.renderReelVariant({
      confession,
      animationStyle: animationStyle || 'FADE',
      hookText: hookText || undefined,
      durationMs: durationMs || 9000,
      ctaText: ctaText || undefined,
    });

    return NextResponse.json({
      success: true,
      data: variant,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to render reel variant' },
      { status: 500 }
    );
  }
}
