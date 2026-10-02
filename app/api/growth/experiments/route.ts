import { NextRequest, NextResponse } from 'next/server';
import { growthStore } from '@/lib/growthStore';
import { experimentService } from '@/services/growth/experimentService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const experiments = await growthStore.getExperiments();
    return NextResponse.json({
      success: true,
      data: experiments,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch experiments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { name, hypothesis, factor, variants, notes } = body;

    if (!name || !hypothesis || !factor || !Array.isArray(variants) || variants.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Name, hypothesis, factor, and at least 2 variants are required.' },
        { status: 400 }
      );
    }

    const created = await experimentService.createExperiment({
      name,
      hypothesis,
      factor,
      variants,
      notes,
    });

    return NextResponse.json({
      success: true,
      data: created,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to create experiment' },
      { status: 500 }
    );
  }
}
