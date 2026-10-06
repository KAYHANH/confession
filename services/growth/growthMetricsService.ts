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
  PostPerformanceRecord,
  CategoryDetailedGrowthStats,
  FormatDetailedStats,
  TimeWindowDetailedStats,
  PostGapDetailedStats,
  PostDensityStats,
  CombinationStats,
  RecencyTrends,
  PercentileDistribution,
  AccountLearningSummary,
  ConfidenceLevel,
  StandardCategoryType,
  FrequencySaturationBucket,
  FrequencySaturationAnalysis,
} from '@/types/growth';
import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';

// Account timezone — IST (UTC+5:30). All time-slot analysis MUST use this
// so that "peak hour 3" means 3 AM IST, not 3 AM UTC (which is 8:30 AM IST).
const ACCOUNT_TIMEZONE = 'Asia/Kolkata';

/**
 * Extract the date key (YYYY-MM-DD) in the account timezone from an ISO timestamp.
 */
function getDateKeyInAccountTz(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: ACCOUNT_TIMEZONE,
  }).format(date);
}

/**
 * Extract the hour-of-day (0–23) in the account timezone from an ISO timestamp.
 */
function getHourInAccountTz(isoString: string): number {
  const date = new Date(isoString);
  const hourStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: ACCOUNT_TIMEZONE,
  }).format(date);
  // '24' is returned for midnight by some engines; normalise to 0
  const h = parseInt(hourStr, 10);
  return h === 24 ? 0 : h;
}

/**
 * Extract the minute (0–59) in the account timezone.
 */
function getMinuteInAccountTz(isoString: string): number {
  const date = new Date(isoString);
  const minStr = new Intl.DateTimeFormat('en-US', {
    minute: 'numeric',
    timeZone: ACCOUNT_TIMEZONE,
  }).format(date);
  return parseInt(minStr, 10) || 0;
}

/**
 * Extract the day-of-week (0 = Sunday … 6 = Saturday) in the account timezone.
 */
function getDayInAccountTz(isoString: string): number {
  const date = new Date(isoString);
  const dayStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: ACCOUNT_TIMEZONE,
  }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? date.getDay();
}

/**
 * Map raw category or text to the standard confession taxonomy
 */
export function mapToStandardCategory(rawCategory: string = '', text: string = ''): StandardCategoryType {
  const lowerCat = (rawCategory || '').toLowerCase();
  const lowerText = (text || '').toLowerCase();

  if (lowerCat.includes('teacher') || lowerText.includes('teacher') || lowerText.includes('professor')) return 'teacher';
  if (lowerCat.includes('crush') || lowerText.includes('crush')) return 'crush';
  if (lowerCat.includes('love') || lowerText.includes('in love') || lowerText.includes('heartbreak')) return 'love';
  if (lowerCat.includes('relationship') || lowerCat.includes('dating') || lowerText.includes('boyfriend') || lowerText.includes('girlfriend') || lowerText.includes('dating')) return 'relationship';
  if (lowerCat.includes('friend') || lowerText.includes('best friend') || lowerText.includes('friendship') || lowerText.includes('bff')) return 'friendship';
  if (lowerCat.includes('school') || lowerText.includes('school') || lowerText.includes('homework')) return 'school';
  if (lowerCat.includes('college') || lowerCat.includes('campus') || lowerText.includes('college') || lowerText.includes('hostel') || lowerText.includes('semester')) return 'college';
  if (lowerCat.includes('funny') || lowerCat.includes('humor') || lowerText.includes('hilarious') || lowerText.includes('funny') || lowerText.includes('lol')) return 'funny';
  if (lowerCat.includes('emotional') || lowerText.includes('crying') || lowerText.includes('depressed') || lowerText.includes('sad')) return 'emotional';
  if (lowerCat.includes('advice') || lowerText.includes('need advice') || lowerText.includes('what should i do')) return 'advice';
  if (lowerCat.includes('question') || lowerText.includes('?')) return 'question';
  if (lowerCat.includes('drama') || lowerText.includes('fight') || lowerText.includes('cheated') || lowerText.includes('betrayal')) return 'drama';
  if (lowerCat.includes('controvers') || lowerText.includes('unpopular opinion') || lowerText.includes('controversial')) return 'controversial';
  if (['relationship', 'crush', 'love', 'friendship', 'school', 'college', 'teacher', 'funny', 'emotional', 'advice', 'question', 'drama', 'controversial', 'other'].includes(lowerCat)) {
    return lowerCat as StandardCategoryType;
  }
  return 'other';
}

export class GrowthMetricsService {
  /**
   * Extract date key (YYYY-MM-DD) in the specified or account timezone
   */
  public getDateKeyInAccountTz(date: Date | string, tz: string = ACCOUNT_TIMEZONE): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
    }).format(d);
  }

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
   * Calculate percentile (e.g. 25, 50, 75, 90) using linear interpolation
   */
  public calculatePercentile(values: number[], p: number): number {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (lower === upper) return sorted[lower];
    const interpolated = sorted[lower] * (1 - weight) + sorted[upper] * weight;
    return Math.round(interpolated * 10) / 10;
  }

  /**
   * Calculate full P25, P50, P75, P90 distribution
   */
  public calculatePercentiles(values: number[]): PercentileDistribution {
    return {
      p25: this.calculatePercentile(values, 25),
      p50: this.calculatePercentile(values, 50),
      p75: this.calculatePercentile(values, 75),
      p90: this.calculatePercentile(values, 90),
    };
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

    const postsWithSnapshots = latestSnapshotByMedia.size;
    const totalPublished = mediaList.length;

    let dataStatus: 'NO_DATA' | 'INSUFFICIENT_DATA' | 'DATA_AVAILABLE' = 'NO_DATA';
    let dataAvailability: 'NO_PUBLISHED_POSTS' | 'NO_SNAPSHOTS' | 'PARTIAL' | 'COMPLETE' = 'NO_PUBLISHED_POSTS';
    let statusMessage = 'No published posts found.';

    if (totalPublished === 0) {
      dataStatus = 'NO_DATA';
      dataAvailability = 'NO_PUBLISHED_POSTS';
      statusMessage = 'No published posts found.';
    } else if (postsWithSnapshots === 0) {
      dataStatus = 'NO_DATA';
      dataAvailability = 'NO_SNAPSHOTS';
      statusMessage = `Published posts exist (${totalPublished}), but no analytics snapshots collected yet.`;
    } else if (postsWithSnapshots < 5) {
      dataStatus = 'INSUFFICIENT_DATA';
      dataAvailability = postsWithSnapshots < totalPublished ? 'PARTIAL' : 'COMPLETE';
      statusMessage = `Limited analytics collected (${postsWithSnapshots}/${totalPublished} posts tracked, min 5 required for statistical baseline).`;
    } else {
      dataStatus = 'DATA_AVAILABLE';
      dataAvailability = postsWithSnapshots < totalPublished ? 'PARTIAL' : 'COMPLETE';
      statusMessage = `Analytics available across ${postsWithSnapshots}/${totalPublished} published posts.`;
    }

    return {
      total_published: totalPublished,
      posts_last_7_days: posts7d,
      posts_last_30_days: posts30d,
      posts_with_snapshots: postsWithSnapshots,
      total_snapshots: snapshots.length,
      data_status: dataStatus,
      data_availability: dataAvailability,
      status_message: statusMessage,
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
      // Use IST-aware helpers so that a post published at 9:00 AM IST
      // is bucketed into hour=9, not hour=3 (UTC). This was the root cause
      // of the Growth Advisor showing "3:30 AM" instead of "9:00 AM".
      const day = getDayInAccountTz(m.published_at);
      const hour = getHourInAccountTz(m.published_at);
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

  /**
   * Calculate "Time to first observed views" (earliest snapshot where views > 0 or plays > 0)
   */
  public calculateTimeToFirstObservedViews(
    snapshots: MediaPerformanceSnapshot[],
    publishedAt: string
  ): { firstObservedViewsAt: string | null; minutesUntilFirstObservedView: number | null } {
    if (!snapshots || snapshots.length === 0) {
      return { firstObservedViewsAt: null, minutesUntilFirstObservedView: null };
    }
    const sorted = [...snapshots].sort((a, b) => a.actual_age_minutes - b.actual_age_minutes);
    for (const snap of sorted) {
      const v = snap.views ?? 0;
      const p = snap.plays ?? 0;
      if (v > 0 || p > 0) {
        const pubTime = new Date(publishedAt).getTime();
        const obsTime = new Date(snap.collected_at).getTime();
        const diffMinutes = Math.max(0, Math.round((obsTime - pubTime) / 60000));
        return {
          firstObservedViewsAt: snap.collected_at,
          minutesUntilFirstObservedView: isNaN(diffMinutes) ? snap.actual_age_minutes : diffMinutes,
        };
      }
    }
    return { firstObservedViewsAt: null, minutesUntilFirstObservedView: null };
  }

  /**
   * Calculate interval-based snapshot deltas and velocity per hour
   */
  public calculateSnapshotDeltasAndVelocities(
    snapshots: MediaPerformanceSnapshot[]
  ): MediaPerformanceSnapshot[] {
    if (!snapshots || snapshots.length === 0) return [];
    const sorted = [...snapshots].sort((a, b) => a.actual_age_minutes - b.actual_age_minutes);
    const enriched: MediaPerformanceSnapshot[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      if (i === 0) {
        const elapsedMinutes = curr.actual_age_minutes;
        const velocity =
          elapsedMinutes > 0 && curr.views != null
            ? Math.round((curr.views / (elapsedMinutes / 60)) * 10) / 10
            : 0;
        enriched.push({
          ...curr,
          views_delta: curr.views ?? 0,
          reach_delta: curr.reach ?? 0,
          share_delta: curr.shares ?? 0,
          save_delta: curr.saves ?? 0,
          comment_delta: curr.comments ?? 0,
          views_velocity_per_hour: Math.max(0, velocity),
        });
      } else {
        const prev = sorted[i - 1];
        const elapsedMinutes = Math.max(0, curr.actual_age_minutes - prev.actual_age_minutes);
        const viewsDelta =
          curr.views != null && prev.views != null ? curr.views - prev.views : null;
        const reachDelta =
          curr.reach != null && prev.reach != null ? curr.reach - prev.reach : null;
        const shareDelta =
          curr.shares != null && prev.shares != null ? curr.shares - prev.shares : null;
        const saveDelta =
          curr.saves != null && prev.saves != null ? curr.saves - prev.saves : null;
        const commentDelta =
          curr.comments != null && prev.comments != null ? curr.comments - prev.comments : null;

        let velocity = 0;
        if (elapsedMinutes > 0 && viewsDelta != null) {
          velocity = Math.round((viewsDelta / (elapsedMinutes / 60)) * 10) / 10;
        }

        enriched.push({
          ...curr,
          views_delta: viewsDelta,
          reach_delta: reachDelta,
          share_delta: shareDelta,
          save_delta: saveDelta,
          comment_delta: commentDelta,
          views_velocity_per_hour: Math.max(0, velocity),
        });
      }
    }
    return enriched;
  }

  /**
   * Calculate peak growth window based on highest views increase per hour across intervals
   */
  public calculatePeakGrowthWindow(
    snapshots: MediaPerformanceSnapshot[],
    publishedAt: string
  ): {
    peak_growth_window: string | null;
    peak_growth_start_age: number | null;
    peak_growth_end_age: number | null;
    peak_growth_velocity: number | null;
    peak_clock_window: string | null;
  } {
    if (!snapshots || snapshots.length === 0) {
      return {
        peak_growth_window: null,
        peak_growth_start_age: null,
        peak_growth_end_age: null,
        peak_growth_velocity: null,
        peak_clock_window: null,
      };
    }

    const sorted = [...snapshots].sort((a, b) => a.actual_age_minutes - b.actual_age_minutes);
    let maxVelocity = -1;
    let bestStart = 0;
    let bestEnd = 0;

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const startAge = i === 0 ? 0 : sorted[i - 1].actual_age_minutes;
      const endAge = curr.actual_age_minutes;
      const elapsedMinutes = Math.max(1, endAge - startAge);
      const prevViews = i === 0 ? 0 : (sorted[i - 1].views ?? 0);
      const currViews = curr.views ?? 0;
      const deltaViews = Math.max(0, currViews - prevViews);
      const velocity = Math.round((deltaViews / (elapsedMinutes / 60)) * 10) / 10;

      if (velocity > maxVelocity && velocity > 0) {
        maxVelocity = velocity;
        bestStart = startAge;
        bestEnd = endAge;
      }
    }

    if (maxVelocity <= 0) {
      return {
        peak_growth_window: null,
        peak_growth_start_age: null,
        peak_growth_end_age: null,
        peak_growth_velocity: null,
        peak_clock_window: null,
      };
    }

    const peak_growth_window = `${bestStart}–${bestEnd}m`;
    const pubDate = new Date(publishedAt);
    const startDate = new Date(pubDate.getTime() + bestStart * 60000);
    const endDate = new Date(pubDate.getTime() + bestEnd * 60000);

    const formatClock = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: ACCOUNT_TIMEZONE,
      }).format(d);

    const peak_clock_window = `${formatClock(startDate)}–${formatClock(endDate)}`;

    return {
      peak_growth_window,
      peak_growth_start_age: bestStart,
      peak_growth_end_age: bestEnd,
      peak_growth_velocity: maxVelocity,
      peak_clock_window,
    };
  }

  /**
   * Calculate milestone views (1h, 3h, 6h, 12h, 24h, 48h, 72h, 7d)
   */
  public calculateMilestoneViews(snapshots: MediaPerformanceSnapshot[]): {
    views_1h: number | null;
    views_3h: number | null;
    views_6h: number | null;
    views_12h: number | null;
    views_24h: number | null;
    views_48h: number | null;
    views_72h: number | null;
    views_7d: number | null;
  } {
    const targets: Record<string, number> = {
      views_1h: 60,
      views_3h: 180,
      views_6h: 360,
      views_12h: 720,
      views_24h: 1440,
      views_48h: 2880,
      views_72h: 4320,
      views_7d: 10080,
    };

    const result: any = {
      views_1h: null,
      views_3h: null,
      views_6h: null,
      views_12h: null,
      views_24h: null,
      views_48h: null,
      views_72h: null,
      views_7d: null,
    };

    if (!snapshots || snapshots.length === 0) return result;

    for (const [key, targetMinutes] of Object.entries(targets)) {
      const exact = snapshots.find((s) => s.target_age_minutes === targetMinutes);
      if (exact && typeof exact.views === 'number') {
        result[key] = exact.views;
      } else {
        const matching = snapshots.filter(
          (s) =>
            typeof s.views === 'number' &&
            Math.abs(s.actual_age_minutes - targetMinutes) <= Math.max(15, targetMinutes * 0.25)
        );
        if (matching.length > 0) {
          matching.sort(
            (a, b) =>
              Math.abs(a.actual_age_minutes - targetMinutes) -
              Math.abs(b.actual_age_minutes - targetMinutes)
          );
          result[key] = matching[0].views;
        }
      }
    }

    return result;
  }

  /**
   * Build complete PostPerformanceRecord across all 21 dimensions
   */
  public buildPostPerformanceRecord(
    media: PublishedMedia,
    confession?: any,
    snapshots: MediaPerformanceSnapshot[] = [],
    allPublished: PublishedMedia[] = []
  ): PostPerformanceRecord {
    const pubDate = new Date(media.published_at);
    const pubMs = pubDate.getTime();
    const sortedPubs = [...allPublished].sort(
      (a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
    );

    const prevPosts = sortedPubs.filter(
      (p) => new Date(p.published_at).getTime() < pubMs && p.id !== media.id
    );
    const prevPost = prevPosts.length > 0 ? prevPosts[prevPosts.length - 1] : null;
    const gapMinutes = prevPost
      ? Math.max(0, Math.round((pubMs - new Date(prevPost.published_at).getTime()) / 60000))
      : 0;

    const postsInPrev1h = prevPosts.filter(
      (p) => pubMs - new Date(p.published_at).getTime() <= 60 * 60000
    ).length;
    const postsInPrev3h = prevPosts.filter(
      (p) => pubMs - new Date(p.published_at).getTime() <= 180 * 60000
    ).length;
    const postsInPrev6h = prevPosts.filter(
      (p) => pubMs - new Date(p.published_at).getTime() <= 360 * 60000
    ).length;
    const postsInPrev24h = prevPosts.filter(
      (p) => pubMs - new Date(p.published_at).getTime() <= 1440 * 60000
    ).length;

    const enrichedSnaps = this.calculateSnapshotDeltasAndVelocities(snapshots);
    const firstViews = this.calculateTimeToFirstObservedViews(enrichedSnaps, media.published_at);
    const peakGrowth = this.calculatePeakGrowthWindow(enrichedSnaps, media.published_at);
    const milestoneViews = this.calculateMilestoneViews(enrichedSnaps);

    const sortedSnaps = [...enrichedSnaps].sort(
      (a, b) => b.actual_age_minutes - a.actual_age_minutes
    );
    const latestSnap = sortedSnaps[0] || null;

    const perfIndex = latestSnap
      ? this.calculatePerformanceIndex({
          reach: latestSnap.reach,
          shares: latestSnap.shares,
          saves: latestSnap.saves,
          comments: latestSnap.comments,
          profileVisits: latestSnap.profile_visits,
          follows: latestSnap.follows,
        })
      : null;

    const rawText = confession?.cleaned_text || confession?.original_text || '';
    const words = rawText.trim() ? rawText.trim().split(/\s+/) : [];
    const wordCount = words.length;
    const charCount = rawText.length;
    const rawCat = confession?.category || 'other';
    const category = mapToStandardCategory(rawCat, rawText);

    return {
      post_id: confession?.id || media.content_id || media.id,
      instagram_media_id: media.platform_media_id || '',
      content_id: media.content_id,
      published_at: media.published_at,
      format: media.format_type,
      media_type: media.media_type,
      confession_category: category,
      confession_subcategory: confession?.subcategory || undefined,
      hook_type: confession?.hook_type || 'DIRECT_STATEMENT',
      content_length: charCount,
      word_count: wordCount,
      character_count: charCount,
      day_of_week: getDayInAccountTz(media.published_at),
      publish_hour: getHourInAccountTz(media.published_at),
      publish_minute: getMinuteInAccountTz(media.published_at),
      previous_post_gap_minutes: gapMinutes,
      posts_in_previous_1h: postsInPrev1h,
      posts_in_previous_3h: postsInPrev3h,
      posts_in_previous_6h: postsInPrev6h,
      posts_in_previous_24h: postsInPrev24h,
      first_observed_views_at: firstViews.firstObservedViewsAt,
      minutes_until_first_observed_view: firstViews.minutesUntilFirstObservedView,
      peak_growth_window: peakGrowth.peak_growth_window,
      peak_growth_start_age: peakGrowth.peak_growth_start_age,
      peak_growth_end_age: peakGrowth.peak_growth_end_age,
      peak_growth_velocity: peakGrowth.peak_growth_velocity,
      peak_clock_window: peakGrowth.peak_clock_window,
      views_1h: milestoneViews.views_1h,
      views_3h: milestoneViews.views_3h,
      views_6h: milestoneViews.views_6h,
      views_12h: milestoneViews.views_12h,
      views_24h: milestoneViews.views_24h,
      views_48h: milestoneViews.views_48h,
      views_72h: milestoneViews.views_72h,
      views_7d: milestoneViews.views_7d,
      final_observed_views: latestSnap?.views ?? null,
      final_observed_reach: latestSnap?.reach ?? null,
      final_observed_shares: latestSnap?.shares ?? null,
      final_observed_saves: latestSnap?.saves ?? null,
      final_observed_comments: latestSnap?.comments ?? null,
      final_observed_profile_visits: latestSnap?.profile_visits ?? null,
      final_observed_follows: latestSnap?.follows ?? null,
      performance_index: perfIndex,
      percentile: null,
      created_at: media.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Retrieve or synchronize all PostPerformanceRecords
   */
  public async getOrSyncPostPerformanceRecords(): Promise<PostPerformanceRecord[]> {
    const existing = await growthStore.getPostPerformanceRecords();
    const mediaList = await growthStore.getPublishedMedia();

    if (existing.length > 0 && (mediaList.length === 0 || existing.length >= mediaList.length)) {
      return existing;
    }

    const allSnaps = await growthStore.getSnapshots();
    const allConfessions = mockStore.getConfessions();
    const records: PostPerformanceRecord[] = [];

    for (const m of mediaList) {
      const snaps = allSnaps.filter((s) => s.published_media_id === m.id);
      const conf = allConfessions.find((c) => c.id === m.content_id);
      const record = this.buildPostPerformanceRecord(m, conf, snaps, mediaList);
      records.push(record);
      await growthStore.savePostPerformanceRecord(record);
    }

    // Calculate percentiles across records
    const reachVals = records
      .map((r) => r.final_observed_reach)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);

    for (const r of records) {
      if (typeof r.final_observed_reach === 'number' && reachVals.length > 0) {
        const rank = reachVals.filter((v) => v <= r.final_observed_reach!).length;
        r.percentile = Math.round((rank / reachVals.length) * 100);
        await growthStore.savePostPerformanceRecord(r);
      }
    }

    return records;
  }

  /**
   * Detailed Confession Type Analysis across the 14 standard categories
   */
  public async getCategoryGrowthAnalysis(): Promise<CategoryDetailedGrowthStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const categories: StandardCategoryType[] = [
      'relationship',
      'crush',
      'love',
      'friendship',
      'school',
      'college',
      'teacher',
      'funny',
      'emotional',
      'advice',
      'question',
      'drama',
      'controversial',
      'other',
    ];

    const results: CategoryDetailedGrowthStats[] = [];

    for (const cat of categories) {
      const matched = records.filter(
        (r) => r.confession_category.toLowerCase() === cat.toLowerCase()
      );

      const views = matched
        .map((r) => r.final_observed_views)
        .filter((v): v is number => typeof v === 'number');
      const reach = matched
        .map((r) => r.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const shares = matched
        .map((r) => r.final_observed_shares)
        .filter((v): v is number => typeof v === 'number');
      const saves = matched
        .map((r) => r.final_observed_saves)
        .filter((v): v is number => typeof v === 'number');
      const comments = matched
        .map((r) => r.final_observed_comments)
        .filter((v): v is number => typeof v === 'number');
      const visits = matched
        .map((r) => r.final_observed_profile_visits)
        .filter((v): v is number => typeof v === 'number');
      const follows = matched
        .map((r) => r.final_observed_follows)
        .filter((v): v is number => typeof v === 'number');
      const firstViews = matched
        .map((r) => r.minutes_until_first_observed_view)
        .filter((v): v is number => typeof v === 'number');
      const peakVels = matched
        .map((r) => r.peak_growth_velocity)
        .filter((v): v is number => typeof v === 'number');
      const v24h = matched
        .map((r) => r.views_24h)
        .filter((v): v is number => typeof v === 'number');
      const v48h = matched
        .map((r) => r.views_48h)
        .filter((v): v is number => typeof v === 'number');

      results.push({
        category: cat,
        post_count: matched.length,
        median_views: this.calculateMedian(views),
        mean_views: this.calculateMean(views),
        median_reach: this.calculateMedian(reach),
        mean_reach: this.calculateMean(reach),
        median_shares: this.calculateMedian(shares),
        median_saves: this.calculateMedian(saves),
        median_comments: this.calculateMedian(comments),
        median_profile_visits: this.calculateMedian(visits),
        median_follows: this.calculateMedian(follows),
        median_time_to_first_observed_view: this.calculateMedian(firstViews),
        median_peak_growth_velocity: this.calculateMedian(peakVels),
        median_24h_views: this.calculateMedian(v24h),
        median_48h_views: this.calculateMedian(v48h),
      });
    }

    return results;
  }

  /**
   * Detailed Format Analysis (IMAGE vs CAROUSEL vs REEL vs VIDEO)
   */
  public async getFormatDetailedAnalysis(): Promise<FormatDetailedStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const formats: MediaFormatType[] = ['IMAGE', 'CAROUSEL', 'REEL', 'VIDEO'];
    const results: FormatDetailedStats[] = [];

    for (const fmt of formats) {
      const matched = records.filter((r) => r.format === fmt);

      const views = matched
        .map((r) => r.final_observed_views)
        .filter((v): v is number => typeof v === 'number');
      const reach = matched
        .map((r) => r.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const shares = matched
        .map((r) => r.final_observed_shares)
        .filter((v): v is number => typeof v === 'number');
      const saves = matched
        .map((r) => r.final_observed_saves)
        .filter((v): v is number => typeof v === 'number');
      const comments = matched
        .map((r) => r.final_observed_comments)
        .filter((v): v is number => typeof v === 'number');
      const follows = matched
        .map((r) => r.final_observed_follows)
        .filter((v): v is number => typeof v === 'number');
      const v24h = matched
        .map((r) => r.views_24h)
        .filter((v): v is number => typeof v === 'number');
      const peakVels = matched
        .map((r) => r.peak_growth_velocity)
        .filter((v): v is number => typeof v === 'number');
      const firstViews = matched
        .map((r) => r.minutes_until_first_observed_view)
        .filter((v): v is number => typeof v === 'number');

      const totalReach = reach.reduce((a, b) => a + b, 0);
      const totalShares = shares.reduce((a, b) => a + b, 0);
      const totalSaves = saves.reduce((a, b) => a + b, 0);
      const totalComments = comments.reduce((a, b) => a + b, 0);
      const totalFollows = follows.reduce((a, b) => a + b, 0);

      results.push({
        format_type: fmt,
        sample_size: matched.length,
        median_views: this.calculateMedian(views),
        mean_views: this.calculateMean(views),
        median_reach: this.calculateMedian(reach),
        share_rate: totalReach > 0 ? Math.round((totalShares / totalReach) * 10000) / 100 : 0,
        save_rate: totalReach > 0 ? Math.round((totalSaves / totalReach) * 10000) / 100 : 0,
        comment_rate: totalReach > 0 ? Math.round((totalComments / totalReach) * 10000) / 100 : 0,
        follow_rate: totalReach > 0 ? Math.round((totalFollows / totalReach) * 10000) / 100 : 0,
        median_24h_views: this.calculateMedian(v24h),
        median_peak_velocity: this.calculateMedian(peakVels),
        median_time_to_first_observed_view: this.calculateMedian(firstViews),
        support_state: this.getSupportState(matched.length),
      });
    }

    return results;
  }

  /**
   * Detailed Publish-Time Analysis by hour of day (60m windows) and day of week
   */
  public async getDetailedTimeSlotAnalysis(): Promise<TimeWindowDetailedStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const results: TimeWindowDetailedStats[] = [];

    // Analyze 24 hourly buckets
    for (let hour = 0; hour < 24; hour++) {
      const matched = records.filter((r) => r.publish_hour === hour);
      const views = matched
        .map((r) => r.final_observed_views)
        .filter((v): v is number => typeof v === 'number');
      const reach = matched
        .map((r) => r.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const shares = matched
        .map((r) => r.final_observed_shares)
        .filter((v): v is number => typeof v === 'number');
      const v24h = matched
        .map((r) => r.views_24h)
        .filter((v): v is number => typeof v === 'number');
      const peakVels = matched
        .map((r) => r.peak_growth_velocity)
        .filter((v): v is number => typeof v === 'number');

      const startLabel = `${hour.toString().padStart(2, '0')}:00`;
      const endLabel = `${((hour + 1) % 24).toString().padStart(2, '0')}:00`;

      results.push({
        bucket_label: `${startLabel} - ${endLabel}`,
        hour_of_day: hour,
        day_of_week: -1,
        window_type: '60m',
        sample_size: matched.length,
        median_views: this.calculateMedian(views),
        median_reach: this.calculateMedian(reach),
        median_shares: this.calculateMedian(shares),
        median_24h_views: this.calculateMedian(v24h),
        median_peak_velocity: this.calculateMedian(peakVels),
      });
    }

    return results;
  }

  /**
   * Detailed Post-Gap Analysis across defined intervals with non-causal phrasing
   */
  public async getDetailedPostGapAnalysis(): Promise<PostGapDetailedStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const buckets: { label: PostGapDetailedStats['gap_bucket']; min: number; max: number }[] = [
      { label: '0–30m', min: 0, max: 30 },
      { label: '30–60m', min: 30, max: 60 },
      { label: '60–90m', min: 60, max: 90 },
      { label: '90–120m', min: 90, max: 120 },
      { label: '120–180m', min: 120, max: 180 },
      { label: '180m+', min: 180, max: Infinity },
    ];

    const results: PostGapDetailedStats[] = [];

    for (const b of buckets) {
      const matched = records.filter(
        (r) =>
          r.previous_post_gap_minutes >= b.min &&
          (b.max === Infinity ? true : r.previous_post_gap_minutes < b.max)
      );

      const views = matched
        .map((r) => r.final_observed_views)
        .filter((v): v is number => typeof v === 'number');
      const reach = matched
        .map((r) => r.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const shares = matched
        .map((r) => r.final_observed_shares)
        .filter((v): v is number => typeof v === 'number');
      const saves = matched
        .map((r) => r.final_observed_saves)
        .filter((v): v is number => typeof v === 'number');
      const v24h = matched
        .map((r) => r.views_24h)
        .filter((v): v is number => typeof v === 'number');
      const peakVels = matched
        .map((r) => r.peak_growth_velocity)
        .filter((v): v is number => typeof v === 'number');

      const medReach = this.calculateMedian(reach);
      const finding =
        matched.length > 0
          ? `Posts with ${b.label} gaps had median reach of ${medReach} in the observed sample (N=${matched.length}).`
          : `No posts observed with ${b.label} gaps in sample.`;

      results.push({
        gap_bucket: b.label,
        sample_size: matched.length,
        median_views: this.calculateMedian(views),
        median_reach: medReach,
        median_shares: this.calculateMedian(shares),
        median_saves: this.calculateMedian(saves),
        median_24h_views: this.calculateMedian(v24h),
        median_peak_velocity: this.calculateMedian(peakVels),
        observational_finding: finding,
      });
    }

    return results;
  }

  /**
   * Post Density Analysis across preceding 1h, 3h, 6h, 24h windows
   */
  public async getPostDensityAnalysis(): Promise<PostDensityStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const windows: (1 | 3 | 6 | 24)[] = [1, 3, 6, 24];
    const densityLabels: PostDensityStats['density_bucket'][] = [
      '1 post',
      '2 posts',
      '3 posts',
      '4+ posts',
    ];

    const results: PostDensityStats[] = [];

    for (const w of windows) {
      for (const d of densityLabels) {
        const matched = records.filter((r) => {
          const count =
            w === 1
              ? r.posts_in_previous_1h
              : w === 3
              ? r.posts_in_previous_3h
              : w === 6
              ? r.posts_in_previous_6h
              : r.posts_in_previous_24h;

          if (d === '1 post') return count === 1;
          if (d === '2 posts') return count === 2;
          if (d === '3 posts') return count === 3;
          return count >= 4;
        });

        const views = matched
          .map((r) => r.final_observed_views)
          .filter((v): v is number => typeof v === 'number');
        const reach = matched
          .map((r) => r.final_observed_reach)
          .filter((v): v is number => typeof v === 'number');
        const shares = matched
          .map((r) => r.final_observed_shares)
          .filter((v): v is number => typeof v === 'number');

        results.push({
          window_hours: w,
          density_bucket: d,
          sample_size: matched.length,
          median_reach: this.calculateMedian(reach),
          median_views: this.calculateMedian(views),
          median_shares: this.calculateMedian(shares),
        });
      }
    }

    return results;
  }

  /**
   * Day + Time + Category Combination Analysis
   */
  public async getCombinationAnalysis(): Promise<CombinationStats[]> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const map = new Map<
      string,
      { category: string; timeWindow: string; format?: MediaFormatType; records: PostPerformanceRecord[] }
    >();

    for (const r of records) {
      const hourLabel = `${r.publish_hour.toString().padStart(2, '0')}:00`;
      const key = `${r.confession_category} + ${hourLabel}`;
      if (!map.has(key)) {
        map.set(key, {
          category: r.confession_category,
          timeWindow: hourLabel,
          format: r.format,
          records: [],
        });
      }
      map.get(key)!.records.push(r);
    }

    const results: CombinationStats[] = [];

    for (const [key, item] of map.entries()) {
      if (item.records.length < 1) continue;
      const reach = item.records
        .map((r) => r.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const views = item.records
        .map((r) => r.final_observed_views)
        .filter((v): v is number => typeof v === 'number');

      let confidence: ConfidenceLevel = 'LOW';
      if (item.records.length >= 10) confidence = 'HIGH';
      else if (item.records.length >= 4) confidence = 'MEDIUM';

      results.push({
        key,
        category: item.category,
        time_window: item.timeWindow,
        format: item.format,
        sample_size: item.records.length,
        median_reach: this.calculateMedian(reach),
        median_views: this.calculateMedian(views),
        confidence,
      });
    }

    return results.sort((a, b) => b.median_reach - a.median_reach);
  }

  /**
   * Recency Trends (last 30 days vs historical)
   */
  public async getRecencyTrends(): Promise<RecencyTrends> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const nowMs = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    const recentPosts = records.filter(
      (r) => nowMs - new Date(r.published_at).getTime() <= thirtyDaysMs
    );
    const historicalPosts = records.filter(
      (r) => nowMs - new Date(r.published_at).getTime() > thirtyDaysMs
    );

    const categories = Array.from(new Set(records.map((r) => r.confession_category)));
    const formats: MediaFormatType[] = ['IMAGE', 'CAROUSEL', 'REEL'];

    const risingCats: any[] = [];
    const decliningCats: any[] = [];

    for (const cat of categories) {
      const rec = recentPosts.filter((r) => r.confession_category === cat);
      const hist = historicalPosts.filter((r) => r.confession_category === cat);

      if (rec.length >= 1 && hist.length >= 1) {
        const recMed = this.calculateMedian(
          rec.map((r) => r.final_observed_views).filter((v): v is number => typeof v === 'number')
        );
        const histMed = this.calculateMedian(
          hist.map((r) => r.final_observed_views).filter((v): v is number => typeof v === 'number')
        );

        if (histMed > 0) {
          const diffPct = Math.round(((recMed - histMed) / histMed) * 100);
          const item = {
            name: cat,
            type: 'category' as const,
            direction: diffPct > 15 ? 'RISING' : diffPct < -15 ? 'DECLINING' : 'STABLE',
            change_percentage: diffPct,
            recent_sample: rec.length,
            historical_sample: hist.length,
            observed_summary: `Recent 30-day median views: ${recMed} vs Historical: ${histMed} (${diffPct > 0 ? '+' : ''}${diffPct}%)`,
          };

          if (item.direction === 'RISING') risingCats.push(item);
          else if (item.direction === 'DECLINING') decliningCats.push(item);
        }
      }
    }

    const risingFmts: any[] = [];
    const decliningFmts: any[] = [];

    for (const fmt of formats) {
      const rec = recentPosts.filter((r) => r.format === fmt);
      const hist = historicalPosts.filter((r) => r.format === fmt);

      if (rec.length >= 1 && hist.length >= 1) {
        const recMed = this.calculateMedian(
          rec.map((r) => r.final_observed_reach).filter((v): v is number => typeof v === 'number')
        );
        const histMed = this.calculateMedian(
          hist.map((r) => r.final_observed_reach).filter((v): v is number => typeof v === 'number')
        );

        if (histMed > 0) {
          const diffPct = Math.round(((recMed - histMed) / histMed) * 100);
          const item = {
            name: fmt,
            type: 'format' as const,
            direction: diffPct > 15 ? 'RISING' : diffPct < -15 ? 'DECLINING' : 'STABLE',
            change_percentage: diffPct,
            recent_sample: rec.length,
            historical_sample: hist.length,
            observed_summary: `Recent 30-day median reach: ${recMed} vs Historical: ${histMed} (${diffPct > 0 ? '+' : ''}${diffPct}%)`,
          };

          if (item.direction === 'RISING') risingFmts.push(item);
          else if (item.direction === 'DECLINING') decliningFmts.push(item);
        }
      }
    }

    return {
      period_comparison: 'last_30_days_vs_historical',
      rising_categories: risingCats,
      declining_categories: decliningCats,
      rising_formats: risingFmts,
      declining_formats: decliningFmts,
      rising_time_windows: [],
      declining_time_windows: [],
    };
  }

  /**
   * Account-Level Learning Summary
   */
  public async getAccountLearningSummary(): Promise<AccountLearningSummary> {
    const records = await this.getOrSyncPostPerformanceRecords();

    const views = records
      .map((r) => r.final_observed_views)
      .filter((v): v is number => typeof v === 'number');
    const reach = records
      .map((r) => r.final_observed_reach)
      .filter((v): v is number => typeof v === 'number');
    const shares = records
      .map((r) => r.final_observed_shares)
      .filter((v): v is number => typeof v === 'number');
    const saves = records
      .map((r) => r.final_observed_saves)
      .filter((v): v is number => typeof v === 'number');
    const comments = records
      .map((r) => r.final_observed_comments)
      .filter((v): v is number => typeof v === 'number');
    const visits = records
      .map((r) => r.final_observed_profile_visits)
      .filter((v): v is number => typeof v === 'number');
    const follows = records
      .map((r) => r.final_observed_follows)
      .filter((v): v is number => typeof v === 'number');
    const v24h = records
      .map((r) => r.views_24h)
      .filter((v): v is number => typeof v === 'number');
    const v48h = records
      .map((r) => r.views_48h)
      .filter((v): v is number => typeof v === 'number');
    const peakVels = records
      .map((r) => r.peak_growth_velocity)
      .filter((v): v is number => typeof v === 'number');
    const firstViews = records
      .map((r) => r.minutes_until_first_observed_view)
      .filter((v): v is number => typeof v === 'number');

    // Category analysis for best performing category
    const catAnalysis = await this.getCategoryGrowthAnalysis();
    const sortedCats = [...catAnalysis]
      .filter((c) => c.post_count > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const bestCategory = sortedCats[0]?.category || 'General';

    // Format analysis for best format
    const fmtAnalysis = await this.getFormatDetailedAnalysis();
    const sortedFmts = [...fmtAnalysis]
      .filter((f) => f.sample_size > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const bestFormat = sortedFmts[0]?.format_type || 'IMAGE';

    // Time window analysis for best publishing window (clock time)
    const timeAnalysis = await this.getDetailedTimeSlotAnalysis();
    const sortedTimes = [...timeAnalysis]
      .filter((t) => t.sample_size > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const bestWindow = sortedTimes[0]?.bucket_label || '20:00 - 21:00';

    // Best post growth elapsed window (e.g. 30–60m)
    const growthWindows = records
      .map((r) => r.peak_growth_window)
      .filter((w): w is string => !!w);
    const windowCounts = new Map<string, number>();
    for (const w of growthWindows) {
      windowCounts.set(w, (windowCounts.get(w) || 0) + 1);
    }
    let bestGrowthWindow = '30–60m';
    let maxGrowthCount = 0;
    for (const [w, count] of windowCounts.entries()) {
      if (count > maxGrowthCount) {
        maxGrowthCount = count;
        bestGrowthWindow = w;
      }
    }

    // Gap analysis for best cadence
    const gapAnalysis = await this.getDetailedPostGapAnalysis();
    const sortedGaps = [...gapAnalysis]
      .filter((g) => g.sample_size > 0)
      .sort((a, b) => b.median_reach - a.median_reach);
    const bestCadence = sortedGaps[0]?.gap_bucket
      ? `${sortedGaps[0].gap_bucket} spacing`
      : '60–90m spacing';

    let confidence: ConfidenceLevel = 'LOW';
    if (records.length >= 20) confidence = 'HIGH';
    else if (records.length >= 10) confidence = 'MEDIUM';

    return {
      total_posts_analyzed: records.length,
      median_views: this.calculateMedian(views),
      mean_views: this.calculateMean(views),
      views_distribution: this.calculatePercentiles(views),
      median_reach: this.calculateMedian(reach),
      mean_reach: this.calculateMean(reach),
      reach_distribution: this.calculatePercentiles(reach),
      median_shares: this.calculateMedian(shares),
      median_saves: this.calculateMedian(saves),
      median_comments: this.calculateMedian(comments),
      median_profile_visits: this.calculateMedian(visits),
      median_follows: this.calculateMedian(follows),
      median_24h_views: this.calculateMedian(v24h),
      median_48h_views: this.calculateMedian(v48h),
      median_peak_velocity: this.calculateMedian(peakVels),
      median_time_to_first_observed_view: this.calculateMedian(firstViews),
      best_performing_category: bestCategory,
      best_performing_format: bestFormat,
      best_observed_window: bestWindow,
      best_observed_post_growth_window: bestGrowthWindow,
      best_observed_cadence: bestCadence,
      evidence_count: records.length,
      confidence,
      disclaimer: `Findings reflect observed historical sample (N=${records.length}). Algorithmic shifts and content quality variations may impact individual post outcomes.`,
    };
  }

  /**
   * Posting Frequency Saturation Analysis
   * Models posts_per_day vs median_reach_per_post vs total_daily_reach.
   * Detects reach degradation knee points and calculates optimal account posting frequency.
   */
  public async getPostingFrequencySaturationAnalysis(): Promise<FrequencySaturationAnalysis> {
    const records = await this.getOrSyncPostPerformanceRecords();
    const settings = mockStore.getSettings();
    const defaultTarget = settings.target_daily_posts || 4;

    if (records.length === 0) {
      return {
        buckets: [],
        optimal_posts_per_day: defaultTarget,
        saturation_knee_point: null,
        degradation_detected: false,
        confidence: 0,
        sample_size: 0,
        days_of_data: 0,
        summary: 'No historical post performance data available for frequency saturation analysis.',
      };
    }

    // 1. Group records by calendar day (in account timezone)
    const dayMap = new Map<string, PostPerformanceRecord[]>();
    for (const r of records) {
      const dayKey = getDateKeyInAccountTz(r.published_at);
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
      dayMap.get(dayKey)!.push(r);
    }

    const totalDays = dayMap.size;
    const totalPosts = records.length;

    // 2. Group days by post frequency (posts published on that day)
    const frequencyDayGroups = new Map<number, { dayKey: string; posts: PostPerformanceRecord[] }[]>();
    for (const [dayKey, dayPosts] of dayMap.entries()) {
      const count = dayPosts.length;
      if (!frequencyDayGroups.has(count)) frequencyDayGroups.set(count, []);
      frequencyDayGroups.get(count)!.push({ dayKey, posts: dayPosts });
    }

    const sortedFrequencies = Array.from(frequencyDayGroups.keys()).sort((a, b) => a - b);
    const buckets: FrequencySaturationBucket[] = [];

    for (const freq of sortedFrequencies) {
      const dayEntries = frequencyDayGroups.get(freq)!;
      const allPostsInBucket = dayEntries.flatMap((d) => d.posts);

      const postReaches = allPostsInBucket
        .map((p) => p.final_observed_reach)
        .filter((v): v is number => typeof v === 'number');
      const postViews = allPostsInBucket
        .map((p) => p.final_observed_views)
        .filter((v): v is number => typeof v === 'number');
      const postShares = allPostsInBucket
        .map((p) => p.final_observed_shares)
        .filter((v): v is number => typeof v === 'number');
      const postSaves = allPostsInBucket
        .map((p) => p.final_observed_saves)
        .filter((v): v is number => typeof v === 'number');

      // Daily total reach per day in this frequency
      const dailyReaches = dayEntries.map((d) =>
        d.posts.reduce((sum, p) => sum + (p.final_observed_reach || 0), 0)
      );

      const medianReachPerPost = this.calculateMedian(postReaches);
      const meanReachPerPost = this.calculateMean(postReaches);
      const medianTotalDailyReach = this.calculateMedian(dailyReaches);
      const medianViews = this.calculateMedian(postViews);
      const medianShares = this.calculateMedian(postShares);
      const medianSaves = this.calculateMedian(postSaves);
      const medEngageRate =
        medianReachPerPost > 0
          ? Math.round(((medianShares + medianSaves) / medianReachPerPost) * 1000) / 10
          : 0;

      buckets.push({
        posts_per_day: freq,
        sample_days: dayEntries.length,
        sample_posts: allPostsInBucket.length,
        median_reach_per_post: medianReachPerPost,
        mean_reach_per_post: meanReachPerPost,
        median_total_daily_reach: medianTotalDailyReach,
        median_views_per_post: medianViews,
        median_shares_per_post: medianShares,
        median_saves_per_post: medianSaves,
        median_engagement_rate: medEngageRate,
        degradation_percent_vs_peak: 0,
      });
    }

    // 3. Detect Peak, Degradation, and Saturation Knee Point
    let peakReach = 0;
    let peakFreq = defaultTarget;
    for (const b of buckets) {
      if (b.median_reach_per_post > peakReach) {
        peakReach = b.median_reach_per_post;
        peakFreq = b.posts_per_day;
      }
    }

    let saturationKneePoint: number | null = null;
    let degradationDetected = false;

    for (const b of buckets) {
      if (peakReach > 0) {
        const diff = peakReach - b.median_reach_per_post;
        b.degradation_percent_vs_peak = diff > 0 ? Math.round((diff / peakReach) * 100) : 0;
      }
      // If after peak frequency, reach per post drops noticeably (>= 18%), that's a saturation knee
      if (b.posts_per_day > peakFreq && b.degradation_percent_vs_peak >= 18 && saturationKneePoint === null) {
        saturationKneePoint = b.posts_per_day;
        degradationDetected = true;
      }
    }

    // 4. Determine Optimal Posts Per Day
    // Balances median reach per post (60%) and total daily reach (40%) while penalizing steep degradation
    let maxScore = -Infinity;
    let optimalPostsPerDay = defaultTarget;
    const maxDailyReach = Math.max(...buckets.map((b) => b.median_total_daily_reach), 1);

    for (const b of buckets) {
      const reachScore = peakReach > 0 ? b.median_reach_per_post / peakReach : 1;
      const volumeScore = maxDailyReach > 0 ? b.median_total_daily_reach / maxDailyReach : 1;
      const degradationPenalty =
        b.degradation_percent_vs_peak > 25
          ? 0.3
          : b.degradation_percent_vs_peak > 15
          ? 0.15
          : 0;
      const combinedScore = 0.6 * reachScore + 0.4 * volumeScore - degradationPenalty;

      if (combinedScore > maxScore) {
        maxScore = combinedScore;
        optimalPostsPerDay = b.posts_per_day;
      }
    }

    // 5. Statistical Confidence Calculation
    // Minimum 20 posts and 7 days for high confidence
    const minPosts = settings.min_posts_for_cadence_learning ?? 20;
    const minDays = settings.min_days_for_cadence_learning ?? 7;

    const postsRatio = Math.min(1.0, totalPosts / minPosts);
    const daysRatio = Math.min(1.0, totalDays / minDays);
    const baseConfidence = 0.5 * postsRatio + 0.5 * daysRatio;

    const wellSampledBuckets = buckets.filter((b) => b.sample_days >= 2).length;
    const bucketConfidenceFactor =
      buckets.length > 0 ? Math.min(1.0, wellSampledBuckets / Math.max(1, buckets.length)) : 0;
    const confidence =
      Math.round(baseConfidence * (0.7 + 0.3 * bucketConfidenceFactor) * 100) / 100;

    let summary = '';
    if (totalPosts < minPosts || totalDays < minDays) {
      summary = `Preliminary evidence (N=${totalPosts} posts across ${totalDays} days, threshold is ${minPosts} posts / ${minDays} days). Confidence (${Math.round(confidence * 100)}%) is insufficient for authoritative override.`;
    } else if (degradationDetected && saturationKneePoint) {
      summary = `Frequency saturation detected at ~${saturationKneePoint} posts/day. Peak reach per post was observed at ${peakFreq} posts/day (${peakReach} median reach). Optimal frequency recommendation: ${optimalPostsPerDay} posts/day.`;
    } else {
      summary = `Optimal account performance observed at ${optimalPostsPerDay} posts/day (${buckets.find((b) => b.posts_per_day === optimalPostsPerDay)?.median_reach_per_post ?? peakReach} median reach/post) across ${totalDays} days of data.`;
    }

    return {
      buckets,
      optimal_posts_per_day: optimalPostsPerDay,
      saturation_knee_point: saturationKneePoint,
      degradation_detected: degradationDetected,
      confidence,
      sample_size: totalPosts,
      days_of_data: totalDays,
      summary,
    };
  }
}

export const growthMetricsService = new GrowthMetricsService();
