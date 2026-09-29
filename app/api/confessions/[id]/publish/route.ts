import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty or non-JSON body is valid, defaults will apply
    }
    const published = await confessionService.publishConfession(id, {
      cardMode: body.cardMode,
      customCaption: body.customCaption,
      templateId: body.templateId,
    });
    return NextResponse.json(published);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Publishing failed' }, { status: 400 });
  }
}
