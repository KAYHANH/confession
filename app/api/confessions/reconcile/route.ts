import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { reconciliationService } from '@/services/reconciliationService';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { confessionId } = body;

    if (confessionId) {
      const res = await reconciliationService.reconcileConfession(confessionId);
      return NextResponse.json({
        success: true,
        confession: res.confession,
        changed: res.changed,
        reason: res.reason,
      });
    }

    const batchResult = await reconciliationService.reconcileHistoricalPublishingState();
    return NextResponse.json({
      success: true,
      result: batchResult,
    });
  } catch (error: any) {
    console.error('[ReconciliationAPI] Error during reconciliation:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Reconciliation failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const confessions = mockStore.getConfessions();
    const stats = {
      total: confessions.length,
      published: confessions.filter((c) => c.status === 'PUBLISHED').length,
      failedConfirmed: confessions.filter((c) => c.status === 'FAILED_CONFIRMED').length,
      failedLegacy: confessions.filter((c) => c.status === 'FAILED').length,
      unknownNeedsReview: confessions.filter(
        (c) => c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW'
      ).length,
      duplicateAlreadyPublished: confessions.filter(
        (c) => c.status === 'DUPLICATE_ALREADY_PUBLISHED'
      ).length,
      approved: confessions.filter((c) => c.status === 'APPROVED').length,
      readyForReview: confessions.filter((c) => c.status === 'READY_FOR_REVIEW').length,
      rejected: confessions.filter((c) => c.status === 'REJECTED').length,
    };

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    console.error('[ReconciliationAPI] Error fetching reconciliation stats:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
