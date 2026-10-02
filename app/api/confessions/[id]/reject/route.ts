import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await Promise.resolve(props.params);
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Rejected by Admin';
    const updated = await confessionService.rejectConfession(id, reason);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Rejection failed' }, { status: 400 });
  }
}
