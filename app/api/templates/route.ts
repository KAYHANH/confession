import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { Template } from '@/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const templateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional().default(''),
  background: z.string().min(1, 'Background is required'),
  text_color: z.string().min(1, 'Text color is required'),
  accent_color: z.string().min(1, 'Accent color is required'),
  font_family: z.enum(['sans', 'serif']),
  font_size: z.number().min(18).max(72).default(44),
  show_branding: z.boolean().default(true),
  show_confession_number: z.boolean().default(true),
  show_name: z.boolean().default(true),
  layout_config: z.record(z.any()).optional().default({}),
  active: z.boolean().default(true),
});

export async function GET() {
  try {
    const templates = mockStore.getTemplates();
    return NextResponse.json(templates);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = templateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid template data' }, { status: 400 });
    }

    const newTemplate: Template = {
      ...parsed.data,
      id: `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = mockStore.addTemplate(newTemplate);
    return NextResponse.json(saved, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to create template' }, { status: 500 });
  }
}
