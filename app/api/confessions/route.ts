import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { mockStore } from '@/lib/mockStore';
import { Confession, ConfessionStatus } from '@/types';
import { z } from 'zod';

const createConfessionSchema = z.object({
  name: z.string().optional().default('Anonymous'),
  original_text: z.string().min(5, 'Confession text must be at least 5 characters'),
  is_anonymous: z.boolean().optional().default(true),
  template_id: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as ConfessionStatus | undefined;
    const moderationStatus = searchParams.get('moderationStatus') || undefined;
    const search = searchParams.get('search') || undefined;
    const templateId = searchParams.get('templateId') || undefined;
    const sortBy = (searchParams.get('sortBy') as any) || 'newest';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const result = await confessionService.getConfessions({
      status,
      moderationStatus,
      search,
      templateId,
      sortBy,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch confessions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createConfessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { name, original_text, is_anonymous, template_id } = parsed.data;
    const id = `confession-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newConfession: Confession = {
      id,
      google_sheet_id: 'manual_entry',
      google_sheet_name: 'Direct Submission',
      google_sheet_row: mockStore.getConfessions().length + 2,
      name: name || 'Anonymous',
      original_text,
      cleaned_text: original_text,
      display_name: is_anonymous ? 'Anonymous' : (name || 'Anonymous'),
      is_anonymous: !!is_anonymous,
      status: 'IMPORTED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: false,
      template_id: template_id || '11111111-1111-1111-1111-111111111111',
      generated_image_url: null,
      generated_image_path: null,
      caption: null,
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockStore.addConfession(newConfession);

    // Automatically run initial AI & moderation processing
    const processed = await confessionService.processConfession(id);

    return NextResponse.json(processed, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to create confession' }, { status: 500 });
  }
}
