import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { backgroundJobService } from '@/services/backgroundJobService';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const job = backgroundJobService.getJob(id);

  if (!job) {
    return NextResponse.json(
      { success: false, error: `Background job not found: ${id}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
