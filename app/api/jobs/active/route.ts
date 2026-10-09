import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { backgroundJobService } from '@/services/backgroundJobService';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const activeJob = backgroundJobService.getActiveJob();

  return NextResponse.json({
    success: true,
    activeJob: activeJob || null,
  });
}
