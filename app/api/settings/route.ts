import { NextRequest, NextResponse } from 'next/server';
import { settingsService } from '@/services/settingsService';
import { confessionService } from '@/services/confessionService';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const settings = await settingsService.getSettings();
    return NextResponse.json({
      success: true,
      settings,
      version: settings.settings_version || 1,
      updatedAt: settings.updated_at || new Date().toISOString(),
      // Top-level fields preserved for backward compatibility
      ...settings,
      auto_publish_enabled: settings.auto_publish,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FETCH_SETTINGS_FAILED',
          message: error?.message || 'Failed to fetch settings',
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();

    // 1. Validate payload
    const validation = settingsService.validateSettings(body);
    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: validation.errors.join('; '),
            details: validation.errors,
          },
        },
        { status: 400 }
      );
    }

    const expectedVersion =
      typeof body.expected_version === 'number'
        ? body.expected_version
        : typeof body.expectedVersion === 'number'
        ? body.expectedVersion
        : undefined;

    // 2. Persist atomically with write verification
    let updateResult;
    try {
      updateResult = await settingsService.updateSettings(body, {
        author: 'admin',
        expectedVersion,
      });
    } catch (updateErr: any) {
      if (updateErr?.code === 'CONFLICT') {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CONFLICT',
              message: updateErr.message,
              currentVersion: updateErr.currentVersion,
            },
          },
          { status: 409 }
        );
      }
      throw updateErr;
    }

    // 3. Cascade branding/moderation updates to existing unpublished confessions
    const syncResult = await confessionService.syncSettingsToConfessions(body);

    return NextResponse.json({
      success: true,
      settings: updateResult.settings,
      version: updateResult.version,
      updatedAt: updateResult.updatedAt,
      changed_fields: updateResult.changedFields,
      confessions_synced: syncResult.updatedCount,
      schedule_recalculated: syncResult.scheduleRecalculated || updateResult.scheduleRecalculated,
      // Backward compatibility fields
      ...updateResult.settings,
      auto_publish_enabled: updateResult.settings.auto_publish,
    });
  } catch (error: any) {
    console.error('[API Settings] Failed to persist settings:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SETTINGS_PERSISTENCE_FAILED',
          message: error?.message || 'Failed to persist settings',
        },
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}
