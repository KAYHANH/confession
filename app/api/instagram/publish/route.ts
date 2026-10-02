import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();
    const { confessionId } = body;

    if (!confessionId) {
      return NextResponse.json({ error: 'confessionId is required' }, { status: 400 });
    }

    const published = await confessionService.publishConfession(confessionId);
    return NextResponse.json(published);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Instagram publishing failed' }, { status: 400 });
  }
}
