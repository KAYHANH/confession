import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { confessionService } from '@/services/confessionService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { id } = await Promise.resolve(props.params);
    const template = mockStore.getTemplateById(id);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch template' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { id } = await Promise.resolve(props.params);
    const body = await request.json();
    const updated = mockStore.updateTemplate(id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    // Invalidate cached images for confessions using this template so they re-render
    await confessionService.invalidateImagesForTemplate(id);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update template' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { id } = await Promise.resolve(props.params);
    const deleted = mockStore.deleteTemplate(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to delete template' }, { status: 500 });
  }
}
