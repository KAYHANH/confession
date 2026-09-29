/**
 * ConfessionFlow - Growth Metrics & Analytics Calculation Service
 * Implements rigorous statistical aggregation, percentile benchmarking,
 * performance curve velocity modeling, and the ConfessionFlow Performance Index.
 */

import {
  AccountGrowthOverview,
  FormatComparisonStats,
  TimeSlotStats,
  PostGapStats,
  CategoryGrowthStats,
  HookPerformanceStats,
  PostGrowthAnalysis,
  PerformanceCurvePoint,
  StatisticalSupportState,
  MediaFormatType,
  HookType,
  PublishedMedia,
  MediaPerformanceSnapshot,
  ContentFeatures,
} from '@/types/growth';
import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';

export class GrowthMetricsService {
  /**
   * Helper: Calculate median of numeric array
   */
  public calculateMedian(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid];
    }
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  }

  /**
   * Helper: Calculate mean of numeric array
   */
  public calculateMean(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const sum = values.reduce((acc, curr) => acc + curr, 0);
    return Math.round((sum / values.length) * 10) / 10;
  }

  /**
   * Helper: Derive statistical support state based on sample size
   */
  public getSupportState(sampleSize: number): StatisticalSupportState {
    if (sampleSize < 5) return 'INSUFFICIENT_DATA';
    if (sampleSize < 10) return 'PRELIMINARY';
    if (sampleSize < 20) return 'PROMISING';
    return 'SUPPORTED';
  }

  public determineSupportState(sampleSize: number): StatisticalSupportState {
    return this.getSupportState(sampleSize);
  }

  /**
   * Calculate ConfessionFlow Performance Index (0 - 100)
   * Internal benchmark. NOT an official Instagram metric.
   */
  public calculatePerformanceIndex(metrics: {
    reach?: number | null;
    shares?: number | null;
    saves?: number | null;
    comments?: number | null;
    profileVisits?: number | null;
    follows?: number | null;
  }): number {
    const reach = metrics.reach ?? 0;
    const shares = metrics.shares ?? 0;
    const saves = metrics.saves ?? 0;
    const comments = metrics.comments ?? 0;
    const profileVisits = metrics.profileVisits ?? 0;
    const follows = metrics.follows ?? 0;

    // Weights: Reach (30), Shares (25), Saves (20), Comments (10), Profile Visits (10), Follows (5)
    // Normalized against typical baseline targets (e.g. 2000 reach, 100 shares, 80 saves, 40 comments, 50 visits, 10 follows)
    const normReach = Math.min(100, (reach / 2000) * 100);
    const normShares = Math.min(100, (shares / 80) * 100);
    const normSaves = Math.min(100, (saves / 60) * 100);
    const normComments = Math.min(100, (comments / 30) * 100);
    const normVisits = Math.min(100, (profileVisits / 40) * 100);
    const normFollows = Math.min(100, (follows / 10) * 100);

    const score =
      normReach * 0.3 +
      normShares * 0.25 +
      normSaves * 0.2 +
      normComments * 0.1 +
      normVisits * 0.1 +
      normFollows * 0.05;

    return Math.round(score * 10) / 10;
  }

  /**
   * Generate Account Overview Stats (Mean & Median metrics)
   */
  public async getAccountOverview(): Promise<AccountGrowthOverview> {
    const mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();

    // Map latest snapshot per media item
    const latestSnapshotByMedia = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapshotByMedia.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapshotByMedia.set(snap.published_media_id, snap);
      }
    }

    const reachVals: number[] = [];
    const viewVals: number[] = [];
    const shareVals: number[] = [];
    const commentVals: number[] = [];
    const saveVals: number[] = [];
    const visitVals: number[] = [];

    const nowMs = Date.now();
    let posts7d = 0;
    let posts30d = 0;

    for (const media of mediaList) {
      const pubAgeDays = (nowMs - new Date(media.published_at).getTime()) / (86400 * 1000);
      if (pubAgeDays <= 7) posts7d++;
      if (pubAgeDays <= 30) posts30d++;

      const snap = latestSnapshotByMedia.get(media.id);
      if (snap) {
        if (typeof snap.reach === 'number') reachVals.push(snap.reach);
        if (typeof snap.views === 'number') viewVals.push(snap.views);
        if (typeof snap.shares === 'number') shareVals.push(snap.shares);
        if (typeof snap.comments === 'number') commentVals.push(snap.comments);
        if (typeof snap.saves === 'number') saveVals.push(snap.saves);
        if (typeof snap.profile_visits === 'number') visitVals.push(snap.profile_visits);
      }
    }

    const totalReach = reachVals.reduce((a, b) => a + b, 0);
    const totalInteractions =
      shareVals.reduce((a, b) => a + b, 0) +
      saveVals.reduce((a, b) => a + b, 0) +
      commentVals.reduce((a, b) => a + b, 0);

    const avgEngagementRate =
      totalReach > 0 ? Math.round((totalInteractions / totalReach) * 10000) / 100 : 0;

    return {
      total_published: mediaList.length,
      posts_last_7_days: posts7d,
      posts_last_30_days: posts30d,
      mean_reach: this.calculateMean(reachVals),
      median_reach: this.calculateMedian(reachVals),
      mean_views: this.calculateMean(viewVals),
      median_views: this.calculateMedian(viewVals),
      mean_shares: this.calculateMean(shareVals),
      mean_comments: this.calculateMean(commentVals),
      mean_saves: this.calculateMean(saveVals),
      mean_profile_visits: this.calculateMean(visitVals),
      median_profile_visits: this.calculateMedian(visitVals),
      average_engagement_rate: avgEngagementRate,
      performance_index_weights: {
        reach: 30,
        shares: 25,
        saves: 20,
        comments: 10,
        profile_visits: 10,
        follows: 5,
      },
    };
  }

  /**
   * Compare performance across formats (IMAGE vs REEL vs CAROUSEL)
   */
  public async getFormatComparison(): Promise<FormatComparisonStats[]> {
    const mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();

    const latestSnapMap = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const formats: MediaFormatType[] = ['IMAGE', 'REEL', 'CAROUSEL'];
    const results: FormatComparisonStats[] = [];

    for (const fmt of formats) {
      const matchingMedia = mediaList.filter((m) => m.format_type === fmt);
      const reachVals: number[] = [];
      const viewVals: number[] = [];
      const shareVals: number[] = [];
      const saveVals: number[] = [];
      const commentVals: number[] = [];

      for (const m of matchingMedia) {
        const snap = latestSnapMap.get(m.id);
        if (snap) {
          if (typeof snap.reach === 'number') reachVals.push(snap.reach);
          if (typeof snap.views === 'number') viewVals.push(snap.views);
          if (typeof snap.shares === 'number') shareVals.push(snap.shares);
          if (typeof snap.saves === 'number') saveVals.push(snap.saves);
          if (typeof snap.comments === 'number') commentVals.push(snap.comments);
        }
      }

      const totalReach = reachVals.reduce((a, b) => a + b, 0);
      const totalShares = shareVals.reduce((a, b) => a + b, 0);
      const totalInteractions =
        totalShares + saveVals.reduce((a, b) => a + b, 0) + commentVals.reduce((a, b) => a + b, 0);

      results.push({
        format_type: fmt,
        sample_size: matchingMedia.length,
        median_reach: this.calculateMedian(reachVals),
        mean_reach: this.calculateMean(reachVals),
        median_views: this.calculateMedian(viewVals),
        mean_views: this.calculateMean(viewVals),
        median_shares: this.calculateMedian(shareVals),
        median_saves: this.calculateMedian(saveVals),
        median_comments: this.calculateMedian(commentVals),
        share_rate: totalReach > 0 ? Math.round((totalShares / totalReach) * 10000) / 100 : 0,
        engagement_rate: totalReach > 0 ? Math.round((totalInteractions / totalReach) * 10000) / 100 : 0,
        support_state: this.getSupportState(matchingMedia.length),
      });
    }

    return results;
  }

  /**
   * Post Gap Analysis: Evaluates gaps between consecutive publications.
   * Explicitly notes correlation is not causation.
   */
  public async getPostGapAnalysis(): Promise<PostGapStats[]> {
    const mediaList = await growthStore.getPublishedMedia();
    const sorted = [...mediaList].sort(
      (a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
    );

    const snapshots = await growthStore.getSnapshots();
    const latestSnapMap = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const bucketDef = [
      { name: '0-15m', min: 0, max: 15 },
      { name: '15-30m', min: 15, max: 30 },
      { name: '30-60m', min: 30, max: 60 },
      { name: '60-120m', min: 60, max: 120 },
      { name: '120-240m', min: 120, max: 240 },
      { name: '240m+', min: 240, max: Infinity },
    ] as const;

    const bucketData: Record<string, { reaches: number[]; views: number[]; shares: number[] }> = {};
    for (const b of bucketDef) {
      bucketData[b.name] = { reaches: [], views: [], shares: [] };
    }

    for (let i = 1; i < sorted.length; i++) {
      const prevMs = new Date(sorted[i - 1].published_at).getTime();
      const currMs = new Date(sorted[i].published_at).getTime();
      const gapMins = Math.floor((currMs - prevMs) / (60 * 1000));

      const targetBucket = bucketDef.find((b) => gapMins >= b.min && gapMins < b.max);
      if (targetBucket) {
        const snap = latestSnapMap.get(sorted[i].id);
        if (snap) {
          if (typeof snap.reach === 'number') bucketData[targetBucket.name].reaches.push(snap.reach);
          if (typeof snap.views === 'number') bucketData[targetBucket.name].views.push(snap.views);
          if (typeof snap.shares === 'number') bucketData[targetBucket.name].shares.push(snap.shares);
        }
      }
    }

    return bucketDef.map((b) => {
      const item = bucketData[b.name];
      const totalReach = item.reaches.reduce((acc, c) => acc + c, 0);
      const totalShares = item.shares.reduce((acc, c) => acc + c, 0);

      return {
        gap_bucket: b.name,
        sample_size: item.reaches.length,
        median_reach: this.calculateMedian(item.reaches),
        median_views: this.calculateMedian(item.views),
        share_rate: totalReach > 0 ? Math.round((totalShares / totalReach) * 10000) / 100 : 0,
        correlation_warning: 'Correlation observed, not causal evidence.',
      };
    });
  }

  /**
   * Day of Week × Hour of Day Time Performance Matrix
   */
  public async getTimeSlotAnalysis(): Promise<TimeSlotStats[]> {
    const mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();

    const latestSnapMap = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    // Grid: 7 days × 24 hours
    const grid: Record<string, { reaches: number[]; views: number[] }> = {};
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        grid[`${day}-${hour}`] = { reaches: [], views: [] };
      }
    }

    for (const m of mediaList) {
      const d = new Date(m.published_at);
      const day = d.getDay();
      const hour = d.getHours();
      const snap = latestSnapMap.get(m.id);

      if (snap) {
        const key = `${day}-${hour}`;
        if (grid[key]) {
          if (typeof snap.reach === 'number') grid[key].reaches.push(snap.reach);
          if (typeof snap.views === 'number') grid[key].views.push(snap.views);
        }
      }
    }

    const results: TimeSlotStats[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const item = grid[`${day}-${hour}`];
        if (item.reaches.length > 0) {
          results.push({
            day_of_week: day,
            hour_of_day: hour,
            sample_size: item.reaches.length,
            median_reach: this.calculateMedian(item.reaches),
            mean_reach: this.calculateMean(item.reaches),
            median_views: this.calculateMedian(item.views),
          });
        }
      }
    }

    return results;
  }

  /**
   * Category Performance Breakdown
   */
  public async getCategoryGrowthStats(): Promise<CategoryGrowthStats[]> {
    const mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();
    const featuresList = await growthStore.getAllContentFeatures();

    const featuresByContentId = new Map<string, ContentFeatures>();
    for (const f of featuresList) {
      featuresByContentId.set(f.content_id, f);
    }

    const latestSnapMap = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const catMap = new Map<string, { reaches: number[]; views: number[]; shares: number[]; comments: number[] }>();

    for (const m of mediaList) {
      const feat = featuresByContentId.get(m.content_id);
      const cat = feat?.category || 'General';

      if (!catMap.has(cat)) {
        catMap.set(cat, { reaches: [], views: [], shares: [], comments: [] });
      }
      const item = catMap.get(cat)!;
      const snap = latestSnapMap.get(m.id);
      if (snap) {
        if (typeof snap.reach === 'number') item.reaches.push(snap.reach);
        if (typeof snap.views === 'number') item.views.push(snap.views);
        if (typeof snap.shares === 'number') item.shares.push(snap.shares);
        if (typeof snap.comments === 'number') item.comments.push(snap.comments);
      }
    }

    const results: CategoryGrowthStats[] = [];
    for (const [cat, data] of catMap.entries()) {
      const totalReach = data.reaches.reduce((acc, c) => acc + c, 0);
      const totalShares = data.shares.reduce((acc, c) => acc + c, 0);
      const totalComments = data.comments.reduce((acc, c) => acc + c, 0);

      results.push({
        category: cat,
        post_count: data.reaches.length,
        median_reach: this.calculateMedian(data.reaches),
        median_views: this.calculateMedian(data.views),
        median_shares: this.calculateMedian(data.shares),
        share_rate: totalReach > 0 ? Math.round((totalShares / totalReach) * 10000) / 100 : 0,
        comment_rate: totalReach > 0 ? Math.round((totalComments / totalReach) * 10000) / 100 : 0,
      });
    }

    return results.sort((a, b) => b.post_count - a.post_count);
  }

  /**
   * Hook Performance Breakdown
   */
  public async getHookPerformanceStats(): Promise<HookPerformanceStats[]> {
    const mediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();
    const featuresList = await growthStore.getAllContentFeatures();

    const featuresByContentId = new Map<string, ContentFeatures>();
    for (const f of featuresList) {
      featuresByContentId.set(f.content_id, f);
    }

    const latestSnapMap = new Map<string, MediaPerformanceSnapshot>();
    for (const snap of snapshots) {
      const existing = latestSnapMap.get(snap.published_media_id);
      if (!existing || snap.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(snap.published_media_id, snap);
      }
    }

    const hookMap = new Map<HookType, { reaches: number[]; views: number[]; shares: number[] }>();

    for (const m of mediaList) {
      const feat = featuresByContentId.get(m.content_id);
      const hook = feat?.hook_type || 'DIRECT_STATEMENT';

      if (!hookMap.has(hook)) {
        hookMap.set(hook, { reaches: [], views: [], shares: [] });
      }
      const item = hookMap.get(hook)!;
      const snap = latestSnapMap.get(m.id);
      if (snap) {
        if (typeof snap.reach === 'number') item.reaches.push(snap.reach);
        if (typeof snap.views === 'number') item.views.push(snap.views);
        if (typeof snap.shares === 'number') item.shares.push(snap.shares);
      }
    }

    const results: HookPerformanceStats[] = [];
    for (const [hook, data] of hookMap.entries()) {
      const totalReach = data.reaches.reduce((acc, c) => acc + c, 0);
      const totalShares = data.shares.reduce((acc, c) => acc + c, 0);

      results.push({
        hook_type: hook,
        sample_size: data.reaches.length,
        median_reach: this.calculateMedian(data.reaches),
        median_views: this.calculateMedian(data.views),
        share_rate: totalReach > 0 ? Math.round((totalShares / totalReach) * 10000) / 100 : 0,
        support_state: this.getSupportState(data.reaches.length),
      });
    }

    return results;
  }

  /**
   * Generates a Performance Curve and post-growth analysis for a published post.
   */
  public async getPostGrowthAnalysis(publishedMediaId: string): Promise<PostGrowthAnalysis | null> {
    const media = await growthStore.getPublishedMediaById(publishedMediaId);
    if (!media) return null;

    const snapshots = await growthStore.getSnapshots(media.id);
    const sortedSnaps = [...snapshots].sort((a, b) => a.actual_age_minutes - b.actual_age_minutes);

    const curve: PerformanceCurvePoint[] = [];
    let prevViews = 0;
    let prevMinutes = 0;

    for (const snap of sortedSnaps) {
      const currViews = snap.views ?? 0;
      const currReach = snap.reach ?? 0;
      const currShares = snap.shares ?? 0;
      const currSaves = snap.saves ?? 0;
      const currLikes = snap.likes ?? 0;
      const currComments = snap.comments ?? 0;

      const deltaViews = currViews - prevViews;
      const deltaMinutes = snap.actual_age_minutes - prevMinutes;
      const velocity = deltaMinutes > 0 ? Math.round((deltaViews / (deltaMinutes / 60)) * 10) / 10 : 0;
      const pctGrowth = prevViews > 0 ? Math.round(((currViews - prevViews) / prevViews) * 1000) / 10 : 0;

      curve.push({
        age_bucket: snap.age_bucket,
        target_age_minutes: snap.target_age_minutes,
        actual_age_minutes: snap.actual_age_minutes,
        cumulative_views: currViews,
        cumulative_reach: currReach,
        cumulative_shares: currShares,
        cumulative_saves: currSaves,
        cumulative_likes: currLikes,
        cumulative_comments: currComments,
        absolute_growth: deltaViews,
        growth_rate: velocity,
        percentage_growth: pctGrowth,
        velocity_views_per_hour: velocity,
      });

      prevViews = currViews;
      prevMinutes = snap.actual_age_minutes;
    }

    const latestSnap = sortedSnaps[sortedSnaps.length - 1];
    const performanceIndex = this.calculatePerformanceIndex({
      reach: latestSnap?.reach,
      shares: latestSnap?.shares,
      saves: latestSnap?.saves,
      comments: latestSnap?.comments,
      profileVisits: latestSnap?.profile_visits,
      follows: latestSnap?.follows,
    });

    // Calculate percentile across all published posts
    const allMedia = await growthStore.getPublishedMedia();
    const allSnaps = await growthStore.getSnapshots();
    const postReaches: number[] = [];
    for (const m of allMedia) {
      const mSnaps = allSnaps.filter((s) => s.published_media_id === m.id);
      const last = mSnaps.sort((a, b) => b.actual_age_minutes - a.actual_age_minutes)[0];
      if (last && typeof last.reach === 'number') {
        postReaches.push(last.reach);
      }
    }
    postReaches.sort((a, b) => a - b);
    const myReach = latestSnap?.reach ?? 0;
    const rank = postReaches.filter((r) => r <= myReach).length;
    const percentile = postReaches.length > 0 ? Math.round((rank / postReaches.length) * 100) : 50;

    // Early velocity (first 3h snapshot velocity)
    const earlySnap = curve.find((c) => c.age_bucket === '3h' || c.age_bucket === '60m' || c.age_bucket === '6h');
    const earlyVelocity = earlySnap?.velocity_views_per_hour ?? (curve[0]?.velocity_views_per_hour || 0);

    const feat = await growthStore.getContentFeatures(media.content_id);
    const confession = mockStore.getConfessionById(media.content_id);

    return {
      published_media_id: media.id,
      content_id: media.content_id,
      confession_number: confession?.google_sheet_row || 0,
      preview_text: (confession?.cleaned_text || confession?.original_text || '').slice(0, 80),
      format_type: media.format_type,
      category: feat?.category || 'General',
      published_at: media.published_at,
      performance_index: performanceIndex,
      percentile_in_sample: percentile,
      final_reach: latestSnap?.reach ?? null,
      final_views: latestSnap?.views ?? null,
      final_shares: latestSnap?.shares ?? null,
      final_saves: latestSnap?.saves ?? null,
      final_comments: latestSnap?.comments ?? null,
      curve,
      early_velocity_views_per_hour: earlyVelocity,
    };
  }
}

export const growthMetricsService = new GrowthMetricsService();
