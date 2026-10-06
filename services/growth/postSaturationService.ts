/**
 * ConfessionFlow - Post Saturation & Velocity Observation Service
 * Evaluates whether the most recently published post is still accelerating in reach/views
 * or has plateaued. Prevents aggressive queue throughput from interrupting virality
 * and cannibalizing historical performance.
 */

import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';
import { MediaPerformanceSnapshot, PublishedMedia } from '@/types/growth';

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
  reason: string;
}

export class PostSaturationService {
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

    // If no snapshots exist yet (e.g., published recently within initial measurement point)
    if (sortedSnaps.length < 2) {
      if (elapsedMinutes < 15) {
        const remaining = 15 - elapsedMinutes;
        return {
          hasRecentPost: true,
          previousPostId: latestConfessionId,
          previousMediaId: latestMedia?.id || null,
          publishedAt: publishedAtIso,
          elapsedMinutes,
          postSaturationScore: Math.min(30, Math.round((elapsedMinutes / 15) * 30)),
          isAccelerating: true,
          isPlateaued: false,
          currentVelocityViewsPerHour: 100,
          recentReachGrowth: 50,
          shouldDelayNextPost: true,
          recommendedWaitMinutes: remaining,
          reason: `Previous post is within initial 15-minute measurement window (${elapsedMinutes}m old). Waiting ${remaining}m for initial reach metrics.`,
        };
      }

      return {
        hasRecentPost: true,
        previousPostId: latestConfessionId,
        previousMediaId: latestMedia?.id || null,
        publishedAt: publishedAtIso,
        elapsedMinutes,
        postSaturationScore: 70,
        isAccelerating: false,
        isPlateaued: true,
        currentVelocityViewsPerHour: 50,
        recentReachGrowth: 50,
        shouldDelayNextPost: false,
        recommendedWaitMinutes: 0,
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

    let isAccelerating = false;
    let isPlateaued = false;
    let postSaturationScore = 50;
    let shouldDelayNextPost = false;
    let reason = '';
    let waitMinutes = 0;

    if (previousVel && latestVel.vph > previousVel.vph * 1.15 && elapsedMinutes < 180) {
      // Accelerating growth velocity (e.g. 15m=180 v/hr -> 30m=320 v/hr -> 60m=500 v/hr)
      isAccelerating = true;
      isPlateaued = false;
      postSaturationScore = Math.max(15, Math.min(45, Math.round((elapsedMinutes / 180) * 45)));
      shouldDelayNextPost = true;
      waitMinutes = Math.max(30, 150 - elapsedMinutes);
      reason = `Previous post velocity is actively accelerating (${latestVel.vph} views/hr vs earlier ${previousVel.vph} views/hr). Delaying next post to protect viral growth curve.`;
    } else if (previousVel && latestVel.vph < previousVel.vph * 0.70) {
      // Decelerating / plateaued growth velocity (e.g. 15m=200 v/hr -> 30m=190 v/hr -> 60m=80 v/hr)
      isAccelerating = false;
      isPlateaued = true;
      postSaturationScore = Math.min(95, 75 + Math.round((elapsedMinutes / 240) * 20));
      shouldDelayNextPost = elapsedMinutes < (isQualityFirst ? 75 : 45);
      waitMinutes = shouldDelayNextPost ? (isQualityFirst ? 75 : 45) - elapsedMinutes : 0;
      reason = `Previous post velocity has plateaued (${latestVel.vph} views/hr, down from ${previousVel.vph} views/hr). Saturation score: ${postSaturationScore}/100.`;
    } else {
      // Steady velocity progression
      isAccelerating = false;
      isPlateaued = elapsedMinutes >= 60;
      postSaturationScore = Math.min(85, Math.max(50, Math.round((elapsedMinutes / 120) * 70)));
      shouldDelayNextPost = false;
      waitMinutes = 0;
      reason = `Previous post growth is steady (${latestVel.vph} views/hr, saturation score: ${postSaturationScore}/100). Elapsed: ${elapsedMinutes}m.`;
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
      reason,
    };
  }
}

export const postSaturationService = new PostSaturationService();
