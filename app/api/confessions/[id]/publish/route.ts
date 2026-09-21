import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    const published = await confessionService.publishConfession(id);
    return NextResponse.json(published);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Publishing failed' }, { status: 400 });
  }
}
