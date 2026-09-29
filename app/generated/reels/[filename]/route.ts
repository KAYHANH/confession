import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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

    // Sanitize filename against path traversal
    const safeFilename = path.basename(filename);
    const reelsDir = path.join(process.cwd(), 'public', 'generated', 'reels');
    const filePath = path.join(reelsDir, safeFilename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Reel file not found' }, { status: 404 });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    let contentType = 'video/mp4';
    if (ext === '.webm') contentType = 'video/webm';
    else if (ext === '.html') contentType = 'text/html; charset=utf-8';

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
