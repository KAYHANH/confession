import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { imageService } from '@/services/imageService';
import { mockStore } from '@/lib/mockStore';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const confession = await confessionService.getConfessionById(params.id);
    if (!confession) {
      return NextResponse.json({ error: 'Confession not found' }, { status: 404 });
    }

    const templateId = confession.template_id || mockStore.getTemplates()[0]?.id;
    const template = mockStore.getTemplateById(templateId) || mockStore.getTemplates()[0];
    const settings = mockStore.getSettings();

    const imageResult = await imageService.generatePostImage({
      confession,
      template,
      brandName: settings.brand_name,
      instagramHandle: settings.instagram_handle,
      confessionNumber: confession.google_sheet_row || 1,
    });

    const updated = await confessionService.updateConfession(params.id, {
      generated_image_url: imageResult.publicUrl,
      generated_image_path: imageResult.localPath,
    });

    return NextResponse.json({
      imageUrl: imageResult.publicUrl,
      localPath: imageResult.localPath,
      confession: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Image generation failed' }, { status: 500 });
  }
}
