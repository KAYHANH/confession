import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawParams = await Promise.resolve(props.params);
    const id = decodeURIComponent(rawParams.id || '').trim();
    const restored = await confessionService.restoreConfession(id);
    if (!restored) {
      return NextResponse.json(
        { error: 'Confession not found or could not be restored' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Confession restored successfully to queue',
      confession: restored,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to restore confession' },
      { status: 500 }
    );
  }
}
