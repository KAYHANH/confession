import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

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
  _request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    const confession = await confessionService.getConfessionById(id);
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
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const updated = await confessionService.updateConfession(id, parsed.data);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update confession' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(props.params);
    const deleted = await confessionService.deleteConfession(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete or confession not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to delete confession' }, { status: 500 });
  }
}
