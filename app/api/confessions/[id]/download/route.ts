import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { imageService } from '@/services/imageService';
import { mockStore } from '@/lib/mockStore';
import fs from 'fs';

export const dynamic = 'force-dynamic';

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

    const defaultTemplateId = mockStore.getSettings().default_template_id;
    const templateId = confession.template_id || defaultTemplateId || mockStore.getTemplates()[0]?.id;
    const template = mockStore.getTemplateById(templateId) || mockStore.getTemplateById(defaultTemplateId) || mockStore.getTemplates()[0];
    const settings = mockStore.getSettings();

    // Ensure image is generated
    const imageResult = await imageService.generatePostImage({
      confession,
      template,
      brandName: settings.brand_name,
      instagramHandle: settings.instagram_handle,
      confessionNumber: confession.google_sheet_row || 1,
    });

    const filePath = imageResult.localPath;
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Generated file could not be found' }, { status: 500 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const numFormatted = String(confession.google_sheet_row || 1).padStart(3, '0');
    const filename = `confession-${numFormatted}.png`;

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Download failed' },
      { status: 500 }
    );
  }
}
