import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { startBackgroundRunner } from '@/services/backgroundRunner';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Ensure background runner is active
  try {
    startBackgroundRunner();
  } catch {}

  const confessions = mockStore.getConfessions();
  const sheetConfig = mockStore.getGoogleSheetConfig();

  return NextResponse.json(
    {
      status: 'healthy',
      service: 'ConfessionFlow',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      memory_usage_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      environment: process.env.NODE_ENV || 'production',
      confessions_loaded: confessions.length,
      sheet_configured: Boolean(sheetConfig.spreadsheet_id),
      render_url: process.env.RENDER_EXTERNAL_URL || 'https://confession-5ha2.onrender.com',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
