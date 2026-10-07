/**
 * ConfessionFlow - Post Saturation & Velocity Observation Service
 * Evaluates whether the most recently published post is still accelerating in reach/views
 * or has plateaued. Prevents aggressive queue throughput from interrupting virality
 * and cannibalizing historical performance.
 */

import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';
import { MediaPerformanceSnapshot, PublishedMedia, RealtimePostStatus } from '@/types/growth';

export interface PostSaturationEvaluation {
  hasRecentPost: boolean;
  previousPostId: string | null;
  previousMediaId: string | null;
  publishedAt: string | null;
  elapsedMinutes: number;
  postSaturationScore: number; // 0 to 100 (high = saturated/plateaued, low = actively accelerating)
  isAccelerating: boolean;
  isPlateaued: boolean;
  currentVelocityViewsPerHour: number;
  recentReachGrowth: number;
  shouldDelayNextPost: boolean;
  recommendedWaitMinutes: number;
  historicalPercentile: number;
  headlineAlert?: string;
  reason: string;
  // Backwards compatibility aliases
  currentPostAgeMinutes?: number;
  currentPostViews?: number;
  currentPostReach?: number;
  earlyVelocityViewsPerHour?: number;
}

export class PostSaturationService {
  /**
   * Helper: Calculate historical velocity distribution across previous posts
   */
  private async getHistoricalVelocityDistribution(): Promise<number[]> {
    try {
      const records = await growthStore.getPostPerformanceRecords();
      const velocities: number[] = [];

      for (const r of records) {
        if (typeof r.peak_growth_velocity === 'number' && r.peak_growth_velocity > 0) {
          velocities.push(r.peak_growth_velocity);
        } else if (typeof r.views_1h === 'number' && r.views_1h > 0) {
          velocities.push(r.views_1h);
        }
      }

      if (velocities.length < 5) {
        const snapshots = await growthStore.getSnapshots();
        for (const s of snapshots) {
          if (typeof s.views_velocity_per_hour === 'number' && s.views_velocity_per_hour > 0) {
            velocities.push(s.views_velocity_per_hour);
          }
        }
      }

      return velocities.sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /**
   * Compute percentile rank for a given velocity
   */
  private computeVelocityPercentile(velocity: number, historical: number[]): number {
    if (velocity <= 0) return 10;
    if (historical.length >= 5) {
      const rank = historical.filter((v) => v <= velocity).length;
      return Math.min(99, Math.max(1, Math.round((rank / historical.length) * 100)));
    }

    // Benchmark curve if historical sample is limited
    if (velocity >= 1200) return 96;
    if (velocity >= 900) return 91;
    if (velocity >= 700) return 85;
    if (velocity >= 500) return 75;
    if (velocity >= 300) return 60;
    if (velocity >= 150) return 45;
    if (velocity >= 80) return 30;
    return 15;
  }

  /**
   * Evaluate saturation state of the most recently published post
   */
  public async evaluateSaturation(): Promise<PostSaturationEvaluation> {
    const settings = mockStore.getSettings();
    const isQualityFirst = (settings.scheduling_mode || 'QUALITY_FIRST') === 'QUALITY_FIRST';
    const now = Date.now();

    // 1. Find the most recently published post
    const allPublished = await growthStore.getPublishedMedia();
    const mockConfessions = mockStore.getConfessions();
    const publishedConfessions = mockConfessions.filter(
      (c) => c.status === 'PUBLISHED' && c.published_at
    );

    let latestPublishedAtMs = 0;
    let latestMedia: PublishedMedia | null = null;
    let latestConfessionId: string | null = null;

    for (const m of allPublished) {
      const pubMs = new Date(m.published_at).getTime();
      if (pubMs > latestPublishedAtMs) {
        latestPublishedAtMs = pubMs;
        latestMedia = m;
        latestConfessionId = m.content_id;
      }
    }

    for (const c of publishedConfessions) {
      const pubMs = new Date(c.published_at!).getTime();
      if (pubMs > latestPublishedAtMs) {
        latestPublishedAtMs = pubMs;
        latestConfessionId = c.id;
        latestMedia = allPublished.find((m) => m.content_id === c.id) || null;
      }
    }

    // If no post has ever been published, account is ready
    if (latestPublishedAtMs === 0) {
      return {
        hasRecentPost: false,
        previousPostId: null,
        previousMediaId: null,
        publishedAt: null,
        elapsedMinutes: 9999,
        postSaturationScore: 100,
        isAccelerating: false,
        isPlateaued: true,
        currentVelocityViewsPerHour: 0,
        recentReachGrowth: 0,
        shouldDelayNextPost: false,
        recommendedWaitMinutes: 0,
        historicalPercentile: 50,
        reason: 'No previous post detected. Account is ready for publication.',
      };
    }

    const elapsedMinutes = Math.max(0, Math.floor((now - latestPublishedAtMs) / 60000));
    const publishedAtIso = new Date(latestPublishedAtMs).toISOString();

    // If previous post is older than 6 hours, it has fully reached saturation
    if (elapsedMinutes >= 360) {
      return {
        hasRecentPost: true,
        previousPostId: latestConfessionId,
        previousMediaId: latestMedia?.id || null,
        publishedAt: publishedAtIso,
        elapsedMinutes,
        postSaturationScore: 100,
        isAccelerating: false,
        isPlateaued: true,
        currentVelocityViewsPerHour: 0,
        recentReachGrowth: 0,
        shouldDelayNextPost: false,
        recommendedWaitMinutes: 0,
        historicalPercentile: 50,
        reason: `Previous post was published ${Math.round(elapsedMinutes / 60)}h ago and has reached maturity.`,
      };
    }

    // 2. Fetch point-in-time performance snapshots for the recent post
    let snapshots: MediaPerformanceSnapshot[] = [];
    if (latestMedia) {
      snapshots = await growthStore.getSnapshots(latestMedia.id);
    }

    // Sort snapshots by actual age ascending
    const sortedSnaps = [...snapshots]
      .filter((s) => typeof s.actual_age_minutes === 'number')
      .sort((a, b) => a.actual_age_minutes - b.actual_age_minutes);

    const historicalVelocities = await this.getHistoricalVelocityDistribution();

    const latestSnap = sortedSnaps[sortedSnaps.length - 1];
    const currentViews = latestSnap?.views || latestSnap?.plays || 0;
    const currentReach = latestSnap?.reach || 0;

    // If no snapshots exist yet (e.g., published recently within initial measurement point)
    if (sortedSnaps.length < 2) {
      if (elapsedMinutes < 15) {
        const remaining = 15 - elapsedMinutes;
        const initialVph = 100;
        const pctl = this.computeVelocityPercentile(initialVph, historicalVelocities);
        return {
          hasRecentPost: true,
          previousPostId: latestConfessionId,
          previousMediaId: latestMedia?.id || null,
          publishedAt: publishedAtIso,
          elapsedMinutes,
          postSaturationScore: Math.min(30, Math.round((elapsedMinutes / 15) * 30)),
          isAccelerating: true,
          isPlateaued: false,
          currentVelocityViewsPerHour: initialVph,
          recentReachGrowth: 50,
          shouldDelayNextPost: true,
          recommendedWaitMinutes: remaining,
          historicalPercentile: pctl,
          currentPostAgeMinutes: elapsedMinutes,
          currentPostViews: currentViews,
          currentPostReach: currentReach,
          earlyVelocityViewsPerHour: initialVph,
          reason: `Previous post is within initial 15-minute measurement window (${elapsedMinutes}m old). Waiting ${remaining}m for initial reach metrics.`,
        };
      }

      const baselineVph = 50;
      const pctl = this.computeVelocityPercentile(baselineVph, historicalVelocities);
      return {
        hasRecentPost: true,
        previousPostId: latestConfessionId,
        previousMediaId: latestMedia?.id || null,
        publishedAt: publishedAtIso,
        elapsedMinutes,
        postSaturationScore: 70,
        isAccelerating: false,
        isPlateaued: true,
        currentVelocityViewsPerHour: baselineVph,
        recentReachGrowth: 50,
        shouldDelayNextPost: false,
        recommendedWaitMinutes: 0,
        historicalPercentile: pctl,
        currentPostAgeMinutes: elapsedMinutes,
        currentPostViews: currentViews,
        currentPostReach: currentReach,
        earlyVelocityViewsPerHour: baselineVph,
        reason: `Initial observation window elapsed (${elapsedMinutes}m). Post is eligible for next cadence slot.`,
      };
    }

    // 3. Compute velocity trajectory across snapshots
    const velocities: { age: number; vph: number; reachDelta: number }[] = [];
    for (let i = 1; i < sortedSnaps.length; i++) {
      const prev = sortedSnaps[i - 1];
      const curr = sortedSnaps[i];
      const deltaMinutes = Math.max(1, curr.actual_age_minutes - prev.actual_age_minutes);
      const deltaViews = Math.max(0, (curr.views || curr.plays || 0) - (prev.views || prev.plays || 0));
      const deltaReach = Math.max(0, (curr.reach || 0) - (prev.reach || 0));
      const vph = Math.round((deltaViews / deltaMinutes) * 60);
      velocities.push({ age: curr.actual_age_minutes, vph, reachDelta: deltaReach });
    }

    const latestVel = velocities[velocities.length - 1];
    const previousVel = velocities.length > 1 ? velocities[velocities.length - 2] : null;

    const historicalPercentile = this.computeVelocityPercentile(latestVel.vph, historicalVelocities);

    let isAccelerating = false;
    let isPlateaued = false;
    let postSaturationScore = 50;
    let shouldDelayNextPost = false;
    let headlineAlert: string | undefined;
    let reason = '';
    let waitMinutes = 0;

    // Percentile-based evaluation:
    // If post is in >= 85th percentile OR acceleration ratio > 1.15 in under 3h
    if ((historicalPercentile >= 85 || (previousVel && latestVel.vph > previousVel.vph * 1.15)) && elapsedMinutes < 180) {
      isAccelerating = true;
      isPlateaued = false;
      postSaturationScore = Math.max(15, Math.min(45, Math.round((elapsedMinutes / 180) * 45)));
      shouldDelayNextPost = true;
      waitMinutes = Math.max(30, 150 - elapsedMinutes);
      headlineAlert = `🔥 Post is outperforming historical baseline (${historicalPercentile}th percentile).`;
      reason = `Recent post is actively accelerating and outperforming historical baseline (${latestVel.vph} views/hr, ${historicalPercentile}th percentile). Holding next post by ${waitMinutes}m to give this post more distribution time.`;
    } else if (historicalPercentile < 30 || (previousVel && latestVel.vph < previousVel.vph * 0.70)) {
      // Weak or plateaued velocity
      isAccelerating = false;
      isPlateaued = true;
      postSaturationScore = Math.min(95, 75 + Math.round((elapsedMinutes / 240) * 20));
      shouldDelayNextPost = elapsedMinutes < (isQualityFirst ? 75 : 45);
      waitMinutes = shouldDelayNextPost ? (isQualityFirst ? 75 : 45) - elapsedMinutes : 0;
      headlineAlert = undefined;
      reason = `Previous post velocity has plateaued (${latestVel.vph} views/hr, ${historicalPercentile}th percentile, saturation score: ${postSaturationScore}/100). No evidence that waiting longer will materially improve this post. Resume normal cadence.`;
    } else {
      // Steady velocity
      isAccelerating = false;
      isPlateaued = elapsedMinutes >= 60;
      postSaturationScore = Math.min(85, Math.max(50, Math.round((elapsedMinutes / 120) * 70)));
      shouldDelayNextPost = false;
      waitMinutes = 0;
      headlineAlert = undefined;
      reason = `Previous post growth is steady (${latestVel.vph} views/hr, ${historicalPercentile}th percentile, saturation score: ${postSaturationScore}/100). Elapsed: ${elapsedMinutes}m.`;
    }

    return {
      hasRecentPost: true,
      previousPostId: latestConfessionId,
      previousMediaId: latestMedia?.id || null,
      publishedAt: publishedAtIso,
      elapsedMinutes,
      postSaturationScore,
      isAccelerating,
      isPlateaued,
      currentVelocityViewsPerHour: latestVel.vph,
      recentReachGrowth: latestVel.reachDelta,
      shouldDelayNextPost,
      recommendedWaitMinutes: waitMinutes,
      historicalPercentile,
      headlineAlert,
      reason,
      currentPostAgeMinutes: elapsedMinutes,
      currentPostViews: currentViews,
      currentPostReach: currentReach,
      earlyVelocityViewsPerHour: latestVel.vph,
    };
  }

  /**
   * Return standardized RealtimePostStatus for the GrowthDecisionEngine and UI
   */
  public async getRealtimePostStatus(): Promise<RealtimePostStatus> {
    const evaluation = await this.evaluateSaturation();
    if (!evaluation.hasRecentPost) {
      return {
        has_active_post: false,
        media_id: null,
        confession_id: null,
        published_at: null,
        age_minutes: 0,
        current_views: 0,
        current_reach: 0,
        views_velocity_per_hour: 0,
        historical_percentile: 50,
        is_accelerating: false,
        is_plateaued: true,
        should_hold_next_post: false,
        hold_duration_minutes_recommended: 0,
        message: 'No recently published post. Account queue is ready.',
      };
    }

    const confession = evaluation.previousPostId
      ? mockStore.getConfessionById(evaluation.previousPostId)
      : null;

    return {
      has_active_post: true,
      media_id: evaluation.previousMediaId,
      confession_id: evaluation.previousPostId,
      confession_row: confession?.google_sheet_row,
      published_at: evaluation.publishedAt,
      age_minutes: evaluation.elapsedMinutes,
      current_views: evaluation.currentPostViews || 0,
      current_reach: evaluation.currentPostReach || 0,
      views_velocity_per_hour: evaluation.currentVelocityViewsPerHour,
      historical_percentile: evaluation.historicalPercentile,
      is_accelerating: evaluation.isAccelerating,
      is_plateaued: evaluation.isPlateaued,
      should_hold_next_post: evaluation.shouldDelayNextPost,
      hold_duration_minutes_recommended: evaluation.recommendedWaitMinutes,
      headline_alert: evaluation.headlineAlert,
      message: evaluation.reason,
    };
  }
}

export const postSaturationService = new PostSaturationService();

