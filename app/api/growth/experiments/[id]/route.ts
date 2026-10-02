import { NextRequest, NextResponse } from 'next/server';
import { experimentService } from '@/services/growth/experimentService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await Promise.resolve(props.params);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Experiment ID missing' }, { status: 400 });
    }

    const analysis = await experimentService.analyzeExperiment(id);
    if (!analysis) {
      return NextResponse.json({ success: false, error: 'Experiment not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to analyze experiment' },
      { status: 500 }
    );
  }
}
