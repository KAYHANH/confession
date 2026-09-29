/**
 * ConfessionFlow - Analytics Collection Engine
 * Collects point-in-time performance snapshots for published Instagram media at defined observation milestones.
 * Fully decoupled from publishing: failures here NEVER compromise publishing status.
 */

import { growthStore } from '@/lib/growthStore';
import { getGrowthFeatureFlags } from '@/lib/growthConfig';
import { mockStore } from '@/lib/mockStore';
import { instagramInsightsProvider } from './instagramInsightsProvider';
import {
  PublishedMedia,
  MediaPerformanceSnapshot,
  AgeBucket,
  MediaFormatType,
} from '@/types/growth';
import { Confession } from '@/types';

export const OBSERVATION_MILESTONES: { bucket: AgeBucket; targetMinutes: number; minAgeMinutes: number }[] = [
  { bucket: '15m', targetMinutes: 15, minAgeMinutes: 12 },
  { bucket: '30m', targetMinutes: 30, minAgeMinutes: 25 },
  { bucket: '60m', targetMinutes: 60, minAgeMinutes: 50 },
  { bucket: '3h', targetMinutes: 180, minAgeMinutes: 160 },
  { bucket: '6h', targetMinutes: 360, minAgeMinutes: 330 },
  { bucket: '12h', targetMinutes: 720, minAgeMinutes: 660 },
  { bucket: '24h', targetMinutes: 1440, minAgeMinutes: 1320 },
  { bucket: '48h', targetMinutes: 2880, minAgeMinutes: 2700 },
  { bucket: '72h', targetMinutes: 4320, minAgeMinutes: 4100 },
  { bucket: '7d', targetMinutes: 10080, minAgeMinutes: 9800 },
];

export class AnalyticsCollector {
  private isCollecting = false;

  /**
   * Safe asynchronous registration called after a post is successfully published to Instagram.
   * This is entirely non-blocking and isolated.
   */
  public async registerPublishedMedia(
    confession: Confession,
    publishResult: { mediaId: string; permalink: string },
    formatType: MediaFormatType = 'IMAGE'
  ): Promise<PublishedMedia | null> {
    try {
      const now = new Date().toISOString();
      const publishedAt = confession.published_at || now;

      const mediaRecord: PublishedMedia = {
        id: `pm-${confession.id}`,
        content_id: confession.id,
        platform: 'INSTAGRAM',
        platform_media_id: publishResult.mediaId,
        platform_permalink: publishResult.permalink,
        media_type: formatType === 'REEL' ? 'VIDEO' : 'IMAGE',
        format_type: formatType,
        published_at: publishedAt,
        scheduled_at: confession.scheduled_at,
        account_id: mockStore.getInstagramConfig().account_id || 'default_account',
        status: 'ACTIVE',
        template_id: confession.template_id,
        data_source: 'LIVE_COLLECTION',
        created_at: now,
        updated_at: now,
      };

      const saved = await growthStore.addPublishedMedia(mediaRecord);
      console.log(`📊 [AnalyticsCollector] Registered published media for tracking: ${mediaRecord.id}`);

      // If analytics collection is enabled, trigger initial check asynchronously
      const flags = getGrowthFeatureFlags();
      if (flags.enableAnalyticsCollection && flags.enableGrowthIntelligence) {
        setTimeout(() => {
          this.runCollectionCycle().catch((err) => {
            console.warn('[AnalyticsCollector] Background initial collection cycle error:', err?.message || err);
          });
        }, 1000);
      }

      return saved;
    } catch (err: any) {
      console.error('[AnalyticsCollector] Error registering published media (non-fatal):', err?.message || err);
      return null;
    }
  }

  public async collectSnapshotCycle(): Promise<{ checked: number; snapshotsCollected: number }> {
    return this.runCollectionCycle();
  }

  /**
   * Run a collection cycle across all eligible published media.
   * Idempotent and concurrency-locked.
   */
  public async runCollectionCycle(): Promise<{ checked: number; snapshotsCollected: number }> {
    const flags = getGrowthFeatureFlags();
    if (!flags.enableAnalyticsCollection && !flags.enableGrowthIntelligence) {
      return { checked: 0, snapshotsCollected: 0 };
    }

    if (this.isCollecting) {
      console.log('[AnalyticsCollector] Collection cycle already in progress, skipping overlap.');
      return { checked: 0, snapshotsCollected: 0 };
    }

    this.isCollecting = true;
    let snapshotsCollected = 0;

    try {
      const mediaList = await growthStore.getPublishedMedia();
      const activeMedia = mediaList.filter((m) => m.status === 'ACTIVE' && m.platform_media_id);
      const nowMs = Date.now();

      for (const media of activeMedia) {
        const pubMs = new Date(media.published_at).getTime();
        const ageMinutes = Math.floor((nowMs - pubMs) / (60 * 1000));

        // Skip posts older than 8 days to respect observation window
        if (ageMinutes > 11520) continue;

        // Check milestones
        for (const milestone of OBSERVATION_MILESTONES) {
          if (ageMinutes >= milestone.minAgeMinutes) {
            // Check if snapshot already collected
            const existing = await growthStore.getSnapshot(media.id, milestone.bucket);
            if (!existing) {
              const success = await this.collectSnapshotForMedia(media, milestone.bucket, milestone.targetMinutes, ageMinutes);
              if (success) snapshotsCollected++;
            }
          }
        }
      }

      if (snapshotsCollected > 0) {
        mockStore.addLog({
          action: 'PUBLISHED', // Maps to valid ActivityLog action
          entity_type: 'confession',
          metadata: {
            growth_event: 'GROWTH_ANALYTICS_COMPLETED',
            snapshots_collected: snapshotsCollected,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return { checked: activeMedia.length, snapshotsCollected };
    } catch (err: any) {
      console.error('[AnalyticsCollector] Cycle failure:', err?.message || err);
      return { checked: 0, snapshotsCollected };
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Collect a single snapshot for a given media item and milestone bucket.
   */
  public async collectSnapshotForMedia(
    media: PublishedMedia,
    ageBucket: AgeBucket,
    targetMinutes: number,
    actualMinutes: number
  ): Promise<boolean> {
    try {
      const insights = await instagramInsightsProvider.getMediaInsights(media.platform_media_id, media.format_type);

      const snapshot: MediaPerformanceSnapshot = {
        id: `snap-${media.id}-${ageBucket}`,
        published_media_id: media.id,
        collected_at: new Date().toISOString(),
        target_age_minutes: targetMinutes,
        actual_age_minutes: actualMinutes,
        age_bucket: ageBucket,
        views: insights.views,
        plays: insights.plays,
        reach: insights.reach,
        likes: insights.likes,
        comments: insights.comments,
        shares: insights.shares,
        saves: insights.saves,
        profile_visits: insights.profileVisits,
        follows: insights.follows,
        total_watch_time_ms: insights.totalWatchTimeMs,
        average_watch_time_ms: insights.averageWatchTimeMs,
        replays: insights.replays,
        followers_reached: insights.followersReached,
        non_followers_reached: insights.nonFollowersReached,
        raw_metric_status: insights.rawMetricStatus,
        api_version: insights.apiVersion,
        collection_status: insights.collectionStatus,
        unsupported_metrics: insights.unsupportedMetrics,
        created_at: new Date().toISOString(),
      };

      await growthStore.addSnapshot(snapshot);
      console.log(`📈 [AnalyticsCollector] Snapshot saved: ${media.id} @ ${ageBucket} (Actual: ${actualMinutes}m)`);
      return true;
    } catch (err: any) {
      console.warn(`⚠️ [AnalyticsCollector] Failed to collect snapshot for ${media.id} @ ${ageBucket}:`, err?.message || err);
      return false;
    }
  }

  /**
   * Backfill existing published posts into published_media.
   * Respects Phase 35: marks data_source = 'HISTORICAL_API' and never fabricates historical time-series data.
   */
  public async backfillPublishedPosts(): Promise<number> {
    const publishedPosts = mockStore.getPublishedPosts();
    let backfilledCount = 0;

    for (const post of publishedPosts) {
      const existing = await growthStore.getPublishedMediaById(post.instagram_media_id);
      if (!existing && post.instagram_media_id) {
        const mediaRecord: PublishedMedia = {
          id: `pm-${post.confession_id}`,
          content_id: post.confession_id,
          platform: 'INSTAGRAM',
          platform_media_id: post.instagram_media_id,
          platform_permalink: post.permalink,
          media_type: 'IMAGE',
          format_type: 'IMAGE',
          published_at: post.published_at,
          account_id: mockStore.getInstagramConfig().account_id || 'default_account',
          status: 'ACTIVE',
          data_source: 'HISTORICAL_API',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await growthStore.addPublishedMedia(mediaRecord);
        backfilledCount++;
      }
    }

    return backfilledCount;
  }
}

export const analyticsCollector = new AnalyticsCollector();
