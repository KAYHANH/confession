import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { z } from 'zod';

const updateSchema = z.object({
  cleaned_text: z.string().optional(),
  display_name: z.string().optional(),
  is_anonymous: z.boolean().optional(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  template_id: z.string().optional(),
  status: z.any().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const confession = await confessionService.getConfessionById(params.id);
    if (!confession) {
      return NextResponse.json({ error: 'Confession not found' }, { status: 404 });
    }
    return NextResponse.json(confession);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch confession' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const updated = await confessionService.updateConfession(params.id, parsed.data);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update confession' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = await confessionService.deleteConfession(params.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete or confession not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id: params.id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to delete confession' }, { status: 500 });
  }
}
