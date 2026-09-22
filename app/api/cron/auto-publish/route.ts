import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cronAuth';
import { schedulingService } from '@/services/schedulingService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('confessionflow_session');
  const isAuthorized = verifyCronSecret(request) || !!sessionCookie?.value;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let force = false;
    try {
      const body = await request.json();
      force = !!body.force;
    } catch {
      // Empty body is okay
    }

    const result = await schedulingService.processAutoPublishCycle(force);
    return NextResponse.json({
      success: result.status === 'SUCCESS' || result.status === 'SKIPPED' || result.status === 'RATE_LIMITED',
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Auto-publish execution failed' }, { status: 500 });
  }
}
