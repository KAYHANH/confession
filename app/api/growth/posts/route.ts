import { NextRequest, NextResponse } from 'next/server';
import { growthStore } from '@/lib/growthStore';
import { growthMetricsService } from '@/services/growth/growthMetricsService';
import { analyticsCollector } from '@/services/growth/analyticsCollector';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('backfill') === 'true') {
      const backfilled = await analyticsCollector.backfillPublishedPosts();
      console.log(`[Growth API] Backfilled ${backfilled} existing posts into published_media.`);
    }

    const publishedMedia = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();
    const featuresList = await growthStore.getAllContentFeatures();

    const featMap = new Map<string, any>();
    for (const f of featuresList) featMap.set(f.content_id, f);

    const latestSnapMap = new Map<string, any>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const posts = publishedMedia.map((m) => {
      const snap = latestSnapMap.get(m.id);
      const feat = featMap.get(m.content_id);
      const confession = mockStore.getConfessionById(m.content_id);

      const perfIndex = growthMetricsService.calculatePerformanceIndex({
        reach: snap?.reach,
        shares: snap?.shares,
        saves: snap?.saves,
        comments: snap?.comments,
        profileVisits: snap?.profile_visits,
        follows: snap?.follows,
      });

      return {
        id: m.id,
        content_id: m.content_id,
        platform_media_id: m.platform_media_id,
        permalink: m.platform_permalink,
        format_type: m.format_type,
        published_at: m.published_at,
        confession_number: confession?.google_sheet_row || 0,
        preview_text: (confession?.cleaned_text || confession?.original_text || '').slice(0, 80),
        category: feat?.category || 'General',
        hook_type: feat?.hook_type || 'DIRECT_STATEMENT',
        performance_index: perfIndex,
        metrics: {
          reach: snap?.reach ?? null,
          views: snap?.views ?? null,
          shares: snap?.shares ?? null,
          saves: snap?.saves ?? null,
          likes: snap?.likes ?? null,
          comments: snap?.comments ?? null,
          replays: snap?.replays ?? null,
          latest_age_bucket: snap?.age_bucket ?? 'None',
        },
      };
    });

    return NextResponse.json({
      success: true,
      total: posts.length,
      data: posts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch growth posts' },
      { status: 500 }
    );
  }
}
