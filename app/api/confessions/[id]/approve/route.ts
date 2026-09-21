import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const updated = await confessionService.approveConfession(params.id);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Approval failed' }, { status: 400 });
  }
}
