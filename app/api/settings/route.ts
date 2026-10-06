import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { confessionService } from '@/services/confessionService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
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
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();
    // Strict bidirectional synchronization between auto_publish and publishing_mode
    if (body.auto_publish === false || body.auto_publish_enabled === false) {
      body.auto_publish = false;
      body.auto_publish_enabled = false;
      if (!body.publishing_mode || body.publishing_mode === 'AUTO_PUBLISH') {
        body.publishing_mode = 'MANUAL_APPROVAL';
      }
    } else if (body.publishing_mode === 'MANUAL_APPROVAL' || body.publishing_mode === 'AUTO_APPROVAL') {
      body.auto_publish = false;
      body.auto_publish_enabled = false;
    } else if (body.auto_publish === true || body.auto_publish_enabled === true || body.publishing_mode === 'AUTO_PUBLISH') {
      body.auto_publish = true;
      body.auto_publish_enabled = true;
      body.publishing_mode = 'AUTO_PUBLISH';
    }
    const updated = mockStore.updateSettings(body);

    // Cascade all relevant settings changes to existing unpublished confessions
    const syncResult = await confessionService.syncSettingsToConfessions(body);

    mockStore.addLog({
      action: 'SETTINGS_UPDATED',
      entity_type: 'settings',
      metadata: {
        fields: Object.keys(body),
        confessionsSynced: syncResult.updatedCount,
        scheduleRecalculated: syncResult.scheduleRecalculated,
      },
    });
    return NextResponse.json({
      ...updated,
      auto_publish_enabled: updated.auto_publish,
      confessions_synced: syncResult.updatedCount,
      schedule_recalculated: syncResult.scheduleRecalculated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update settings' }, { status: 500 });
  }
}
