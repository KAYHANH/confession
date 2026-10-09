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
    const { confessionId, ids, forceLiveInstagram, action, resolution } = body;

    if (action === 'RESOLVE_DUPLICATE' && confessionId && resolution) {
      const updated = await reconciliationService.resolveDuplicateCandidate(confessionId, resolution);
      return NextResponse.json({
        success: true,
        confession: updated,
      });
    }

    if (confessionId) {
      const res = await reconciliationService.reconcileRecord(confessionId, { forceLiveInstagram });
      return NextResponse.json({
        success: true,
        confession: mockStore.getConfessionById(confessionId),
        recordResult: res,
        changed: res.changed,
        reason: res.reason,
      });
    }

    if (body.sync === true) {
      const report = await reconciliationService.reconcileBatch({
        ids,
        forceLiveInstagram,
      });

      return NextResponse.json({
        success: true,
        report,
        result: report, // backwards-compatible alias
      });
    }

    const { backgroundJobService } = await import('@/services/backgroundJobService');
    const job = await backgroundJobService.startReconciliationJob({
      ids,
      forceLiveInstagram,
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Reconciliation started in background.',
      job,
    }, { status: 202 });
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
    const progress = reconciliationService.getProgress();

    const alreadyPublished = confessions.filter(
      (c) => c.status === 'PUBLISHED' || c.reconciliation_status === 'ALREADY_PUBLISHED' || c.reconciliation_status === 'VERIFIED'
    ).length;
    const confirmedNotPublished = confessions.filter(
      (c) => c.reconciliation_status === 'CONFIRMED_NOT_PUBLISHED'
    ).length;
    const duplicates = confessions.filter(
      (c) => c.status === 'DUPLICATE_ALREADY_PUBLISHED' || c.reconciliation_status === 'DUPLICATE'
    ).length;
    const unknown = confessions.filter(
      (c) => c.reconciliation_status === 'UNKNOWN' || c.status === 'UNKNOWN'
    ).length;
    const manualReview = confessions.filter(
      (c) => c.reconciliation_status === 'MANUAL_REVIEW' || c.status === 'UNKNOWN_NEEDS_REVIEW'
    ).length;
    const safeToRetry = confessions.filter(
      (c) =>
        c.reconciliation_status === 'CONFIRMED_NOT_PUBLISHED' &&
        (c.status === 'APPROVED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED')
    ).length;
    const unreconciled = confessions.filter(
      (c) =>
        c.reconciliation_status === 'NOT_CHECKED' ||
        c.reconciliation_status === 'CHECKING' ||
        (!c.reconciliation_status && (c.status === 'FAILED' || c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW'))
    ).length;

    const stats = {
      total: confessions.length,
      published: confessions.filter((c) => c.status === 'PUBLISHED').length,
      alreadyPublished,
      confirmedNotPublished,
      duplicates,
      unknown,
      manualReview,
      safeToRetry,
      unreconciled,
      failed: confessions.filter(
        (c) => c.status === 'FAILED' || c.status === 'FAILED_CONFIRMED' || c.status === 'FAILED_REQUIRES_ACTION'
      ).length,
      failedConfirmed: confessions.filter((c) => c.status === 'FAILED_CONFIRMED').length,
      approved: confessions.filter((c) => c.status === 'APPROVED').length,
      scheduled: confessions.filter((c) => c.status === 'SCHEDULED').length,
      readyForReview: confessions.filter((c) => c.status === 'READY_FOR_REVIEW').length,
      rejected: confessions.filter((c) => c.status === 'REJECTED').length,
      isRunning: reconciliationService.isRunning(),
    };

    return NextResponse.json({
      success: true,
      stats,
      progress,
    });
  } catch (error: any) {
    console.error('[ReconciliationAPI] Error fetching reconciliation stats:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
