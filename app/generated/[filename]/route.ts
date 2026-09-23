import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { mockStore } from '@/lib/mockStore';
import { imageService } from '@/services/imageService';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ filename: string }> | { filename: string } }
) {
  try {
    const { filename } = await Promise.resolve(props.params);
    if (!filename) {
      return NextResponse.json({ error: 'Filename missing' }, { status: 400 });
    }

    // Sanitize filename to prevent directory traversal
    const safeFilename = path.basename(filename);
    const generatedDir = path.join(process.cwd(), 'public', 'generated');
    const filePath = path.join(generatedDir, safeFilename);

    const url = new URL(_request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('t') !== null;

    if (fs.existsSync(filePath) && !forceRefresh) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // If file does not exist on disk (or forceRefresh is true), generate on-demand for the confession
    const confessionId = safeFilename.replace(/\.png$/i, '');
    const confession = mockStore.getConfessionById(confessionId);

    if (confession) {
      const defaultTemplateId = mockStore.getSettings().default_template_id;
      const templateId = confession.template_id || defaultTemplateId || mockStore.getTemplates()[0]?.id;
      const template = mockStore.getTemplateById(templateId) || mockStore.getTemplateById(defaultTemplateId) || mockStore.getTemplates()[0];
      const settings = mockStore.getSettings();

      const imgRes = await imageService.generatePostImage({
        confession,
        template,
        brandName: settings.brand_name,
        instagramHandle: settings.instagram_handle,
        confessionNumber: confession.google_sheet_row || 1,
      });

      if (fs.existsSync(imgRes.localPath)) {
        const fileBuffer = fs.readFileSync(imgRes.localPath);
        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
    }

    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error serving image' },
      { status: 500 }
    );
  }
}
