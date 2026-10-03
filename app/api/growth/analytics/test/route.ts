import { NextRequest, NextResponse } from 'next/server';
import { instagramInsightsProvider } from '@/services/growth/instagramInsightsProvider';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const url = new URL(request.url);
    const mediaId = url.searchParams.get('mediaId') || undefined;

    const result = await instagramInsightsProvider.testAnalyticsPermission(mediaId);

    if (result.available) {
      return NextResponse.json({
        success: true,
        connected: 'YES',
        account: '_hpsconfession_',
        instagramUserId: result.accountId,
        media: result.mediaId,
        insights: 'AVAILABLE',
        views: result.sampleMetrics?.views ?? null,
        reach: result.sampleMetrics?.reach ?? null,
        shares: result.sampleMetrics?.shares ?? null,
        likes: result.sampleMetrics?.likes ?? null,
        saves: result.sampleMetrics?.saves ?? null,
        comments: result.sampleMetrics?.comments ?? null,
        message: 'Instagram analytics insights verified successfully.',
      });
    }

    return NextResponse.json(
      {
        success: false,
        connected: result.connected ? 'YES' : 'NO',
        account: result.accountId || '_hpsconfession_',
        insights: 'UNAVAILABLE',
        errorCode: result.errorCode || 'INSIGHTS_UNAVAILABLE',
        error:
          result.errorMessage ||
          'Instagram analytics permission is not available for this token. Reconnect the Instagram account and grant instagram_business_manage_insights.',
      },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to test Instagram analytics connection' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
