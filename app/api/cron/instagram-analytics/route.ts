import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cronAuth';
import { analyticsCollector } from '@/services/growth/analyticsCollector';
import { getGrowthFeatureFlags } from '@/lib/growthConfig';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('confessionflow_session');
  const isAuthorized = verifyCronSecret(request) || !!sessionCookie?.value;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const flags = getGrowthFeatureFlags();
    if (!flags.enableAnalyticsCollection) {
      return NextResponse.json({
        success: true,
        status: 'SKIPPED',
        reason: 'ENABLE_ANALYTICS_COLLECTION feature flag is disabled.',
      });
    }

    const result = await analyticsCollector.runCollectionCycle();

    return NextResponse.json({
      success: true,
      status: 'SUCCESS',
      checked: result.checked,
      snapshotsCollected: result.snapshotsCollected,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Instagram analytics collection cycle failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for simple webhook verification
  return POST(request);
}
