import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = mockStore.getSettings();
    // Return with aliased field for frontend compatibility
    return NextResponse.json({
      ...settings,
      auto_publish_enabled: settings.auto_publish,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.auto_publish_enabled !== undefined && body.auto_publish === undefined) {
      body.auto_publish = Boolean(body.auto_publish_enabled);
    }
    if (body.auto_publish && (!body.publishing_mode || body.publishing_mode === 'MANUAL_APPROVAL')) {
      body.publishing_mode = 'AUTO_PUBLISH';
    }
    const updated = mockStore.updateSettings(body);

    if (body.enable_pii_detection !== undefined) {
      await confessionService.syncPiiSettings(Boolean(body.enable_pii_detection));
    }
    mockStore.addLog({
      action: 'SETTINGS_UPDATED',
      entity_type: 'settings',
      metadata: { fields: Object.keys(body) },
    });
    return NextResponse.json({
      ...updated,
      auto_publish_enabled: updated.auto_publish,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update settings' }, { status: 500 });
  }
}
