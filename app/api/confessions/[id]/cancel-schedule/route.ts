import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    const updated = await confessionService.cancelSchedule(id);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to cancel schedule' }, { status: 400 });
  }
}
