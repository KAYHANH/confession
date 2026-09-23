import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { schedulingService } from '@/services/schedulingService';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ids, triggerPublish = true } = body;

    const result = await confessionService.restartFailedQueue(
      Array.isArray(ids) && ids.length > 0 ? ids : undefined
    );

    // If auto publish is enabled or requested, trigger cycle in background immediately
    const settings = mockStore.getSettings();
    const shouldPublish = triggerPublish && (settings.auto_publish || settings.publishing_mode === 'AUTO_PUBLISH');

    if (shouldPublish && result.restartedCount > 0) {
      setTimeout(() => {
        schedulingService.processAutoPublishCycle(true).catch((err) => {
          console.error('[RestartQueue] Background auto-publish trigger error:', err?.message || err);
        });
      }, 500);
    }

    return NextResponse.json({
      success: true,
      restartedCount: result.restartedCount,
      restartedIds: result.restartedIds,
      skippedRejected: result.skippedRejected,
      skippedPublished: result.skippedPublished,
      message: `Successfully restarted ${result.restartedCount} failed confession(s). ${result.skippedRejected} rejected and ${result.skippedPublished} published confessions were strictly protected.`,
    });
  } catch (error: any) {
    console.error('[RestartQueue] Error restarting queue:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to restart queue' },
      { status: 500 }
    );
  }
}
