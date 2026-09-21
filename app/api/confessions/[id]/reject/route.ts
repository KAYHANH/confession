import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Rejected by Admin';
    const updated = await confessionService.rejectConfession(params.id, reason);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Rejection failed' }, { status: 400 });
  }
}
