import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = mockStore.getSettings();
    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const updated = mockStore.updateSettings(body);
    mockStore.addLog({
      action: 'SETTINGS_UPDATED',
      entity_type: 'settings',
      metadata: { fields: Object.keys(body) },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update settings' }, { status: 500 });
  }
}
