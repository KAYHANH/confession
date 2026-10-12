import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { settingsService } from '@/services/settingsService';
import { cadenceAnalyzer } from '@/services/growth/cadenceAnalyzer';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { mode, fixedGapMinutes, enableExperimental } = body;

    const updates: Record<string, any> = {};
    const validModes = ['AUTO', 'AUTO_GROWTH', 'GROWTH_OPTIMIZED', 'BASELINE', 'MANUAL', 'EXPERIMENT'];
    if (mode && validModes.includes(mode)) {
      updates.scheduling_strategy_mode = mode;
    }
    if (typeof fixedGapMinutes === 'number' && fixedGapMinutes >= 15) {
      updates.manual_fixed_gap_minutes = fixedGapMinutes;
    }
    if (typeof enableExperimental === 'boolean') {
      updates.enable_experimental_scheduling = enableExperimental;
    }

    const result = await settingsService.updateSettings(updates, { author: 'admin' });
    cadenceAnalyzer.invalidateCache();
    const recommendation = await cadenceAnalyzer.getCadenceRecommendation(true);

    return NextResponse.json({
      success: true,
      recommendation,
      settings: result.settings,
      version: result.version,
    });
  } catch (err: any) {
    console.error('[API Cadence Override] Failed to update scheduling mode override:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update override' },
      { status: 500 }
    );
  }
}
