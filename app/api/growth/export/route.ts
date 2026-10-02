import { NextRequest, NextResponse } from 'next/server';
import { growthStore } from '@/lib/growthStore';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();

    const publishedMedia = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();
    const featuresList = await growthStore.getAllContentFeatures();
    const recommendations = await growthStore.getRecommendations();

    const featMap = new Map<string, any>();
    for (const f of featuresList) featMap.set(f.content_id, f);

    const latestSnapMap = new Map<string, any>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const exportRows = publishedMedia.map((m) => {
      const snap = latestSnapMap.get(m.id);
      const feat = featMap.get(m.content_id);
      const confession = mockStore.getConfessionById(m.content_id);
      const rec = recommendations.find((r) => r.content_id === m.content_id);

      const perfIndex = growthMetricsService.calculatePerformanceIndex({
        reach: snap?.reach,
        shares: snap?.shares,
        saves: snap?.saves,
        comments: snap?.comments,
        profileVisits: snap?.profile_visits,
        follows: snap?.follows,
      });

      return {
        media_id: m.id,
        platform_media_id: m.platform_media_id,
        permalink: m.platform_permalink,
        format_type: m.format_type,
        published_at: m.published_at,
        confession_number: confession?.google_sheet_row || 0,
        text_preview: (confession?.cleaned_text || confession?.original_text || '').slice(0, 100),
        category: feat?.category || 'General',
        hook_type: feat?.hook_type || 'DIRECT_STATEMENT',
        performance_index: perfIndex,
        reach: snap?.reach ?? '',
        views: snap?.views ?? '',
        shares: snap?.shares ?? '',
        saves: snap?.saves ?? '',
        likes: snap?.likes ?? '',
        comments: snap?.comments ?? '',
        recommended_format: rec?.recommended_format ?? '',
        recommendation_status: rec?.status ?? '',
      };
    });

    if (format === 'csv') {
      const headers = [
        'media_id',
        'platform_media_id',
        'permalink',
        'format_type',
        'published_at',
        'confession_number',
        'text_preview',
        'category',
        'hook_type',
        'performance_index',
        'reach',
        'views',
        'shares',
        'saves',
        'likes',
        'comments',
        'recommended_format',
        'recommendation_status',
      ];

      const csvRows = [headers.join(',')];
      for (const row of exportRows) {
        const line = headers.map((h) => {
          const val = String((row as any)[h] ?? '').replace(/"/g, '""');
          return `"${val}"`;
        });
        csvRows.push(line.join(','));
      }

      return new NextResponse(csvRows.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="confessionflow-growth-data.csv"',
        },
      });
    }

    return NextResponse.json({
      success: true,
      exported_at: new Date().toISOString(),
      total: exportRows.length,
      data: exportRows,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to export growth data' },
      { status: 500 }
    );
  }
}
