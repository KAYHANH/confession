import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export async function POST(request: NextRequest) {
  try {
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
