import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { imageService } from '@/services/imageService';
import { mockStore } from '@/lib/mockStore';
import { Confession } from '@/types';
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

    const updates: Partial<Confession> = { ...parsed.data };

    // If template, text, or name changes, proactively regenerate the image card
    if (updates.template_id || updates.cleaned_text !== undefined || updates.display_name !== undefined) {
      try {
        const existing = await confessionService.getConfessionById(id);
        if (existing) {
          const merged = { ...existing, ...updates };
          const defaultTemplateId = mockStore.getSettings().default_template_id;
          const templateId = merged.template_id || defaultTemplateId || '44444444-4444-4444-4444-444444444444';
          const template = mockStore.getTemplateById(templateId) || mockStore.getTemplateById(defaultTemplateId) || mockStore.getTemplates()[0];
          const settings = mockStore.getSettings();

          const imgRes = await imageService.generatePostImage({
            confession: merged,
            template,
            brandName: settings.brand_name,
            instagramHandle: settings.instagram_handle,
            confessionNumber: merged.google_sheet_row || 1,
          });

          updates.generated_image_url = imgRes.publicUrl;
          updates.generated_image_path = imgRes.localPath;
        }
      } catch (genErr) {
        console.warn('[PATCH /api/confessions/[id]] Failed to regenerate image card:', genErr);
      }
    }

    const updated = await confessionService.updateConfession(id, updates);
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
