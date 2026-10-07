import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { reconciliationService } from '@/services/reconciliationService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const duplicateGroups = reconciliationService.getDuplicateCandidates();
    return NextResponse.json({
      success: true,
      duplicateGroups,
      totalGroups: duplicateGroups.length,
    });
  } catch (error: any) {
    console.error('[DuplicatesAPI] Error fetching duplicate candidates:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch duplicate candidates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { id, resolution } = body;

    if (!id || !resolution) {
      return NextResponse.json(
        { success: false, error: 'Confession ID and resolution are required' },
        { status: 400 }
      );
    }

    if (!['MARK_DUPLICATE', 'ALLOW_POST', 'CANCEL'].includes(resolution)) {
      return NextResponse.json(
        { success: false, error: 'Invalid resolution action' },
        { status: 400 }
      );
    }

    const updated = await reconciliationService.resolveDuplicateCandidate(id, resolution);
    return NextResponse.json({
      success: true,
      confession: updated,
      message: `Duplicate resolved as ${resolution}`,
    });
  } catch (error: any) {
    console.error('[DuplicatesAPI] Error resolving duplicate candidate:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to resolve duplicate' },
      { status: 500 }
    );
  }
}
