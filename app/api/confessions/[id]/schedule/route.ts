import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    if (!body.scheduledAt) {
      return NextResponse.json({ error: 'scheduledAt timestamp is required' }, { status: 400 });
    }

    const updated = await confessionService.scheduleConfession(params.id, body.scheduledAt);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Scheduling failed' }, { status: 400 });
  }
}
