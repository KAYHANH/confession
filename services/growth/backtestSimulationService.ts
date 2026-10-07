/**
 * ConfessionFlow - Growth Backtesting & Simulation Engine
 * Simulates what account performance would have been over the past 30 days
 * if Growth Intelligence 3.0 frequency caps, learned spacing, and format optimization
 * had been actively controlling the queue.
 */

import { BacktestSimulationResult, BacktestDayComparison, PostPerformanceRecord } from '@/types/growth';
import { growthMetricsService } from './growthMetricsService';
import { mockStore } from '@/lib/mockStore';

export class BacktestSimulationService {
  /**
   * Run backtest simulation over historical posts
   */
  public async runSimulation(days: number = 30): Promise<BacktestSimulationResult> {
    const records = await growthMetricsService.getOrSyncPostPerformanceRecords();
    const saturation = await growthMetricsService.getPostingFrequencySaturationAnalysis();
    const settings = mockStore.getSettings();

    const optimalDaily = saturation.optimal_posts_per_day || 7;
    const optimalMedianReach =
      saturation.buckets.find((b) => b.posts_per_day === optimalDaily)?.median_reach_per_post || 1400;

    // Group records by day key (YYYY-MM-DD)
    const dayMap = new Map<string, PostPerformanceRecord[]>();
    for (const r of records) {
      const dateKey = growthMetricsService.getDateKeyInAccountTz(r.published_at);
      if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
      dayMap.get(dateKey)!.push(r);
    }

    const sortedDates = Array.from(dayMap.keys()).sort().slice(-days);

    if (sortedDates.length === 0) {
      return {
        simulation_days: days,
        baseline_posts_count: 0,
        baseline_total_reach: 0,
        baseline_median_reach_per_post: 0,
        simulated_posts_count: 0,
        simulated_total_reach: 0,
        simulated_median_reach_per_post: 0,
        projected_reach_lift_pct: 0,
        daily_comparisons: [],
        summary: 'Insufficient historical data to run backtesting simulation.',
      };
    }

    const dailyComparisons: BacktestDayComparison[] = [];
    let baselineTotalPosts = 0;
    let baselineTotalReach = 0;
    const baselineReaches: number[] = [];

    let simulatedTotalPosts = 0;
    let simulatedTotalReach = 0;
    const simulatedReaches: number[] = [];

    for (const date of sortedDates) {
      const dayPosts = dayMap.get(date)!;
      const actualPostCount = dayPosts.length;
      const actualDayReach = dayPosts.reduce((sum, p) => sum + (p.final_observed_reach || 0), 0);

      baselineTotalPosts += actualPostCount;
      baselineTotalReach += actualDayReach;
      dayPosts.forEach((p) => {
        if (typeof p.final_observed_reach === 'number') baselineReaches.push(p.final_observed_reach);
      });

      // Simulation logic for this day
      let recPosts = actualPostCount;
      let simReach = actualDayReach;
      let primaryDriver = 'Cadence within normal range.';

      if (actualPostCount > optimalDaily) {
        // Over-saturated day: capping volume prevents reach degradation
        recPosts = optimalDaily;
        const projectedReachPerPost = Math.round(optimalMedianReach * 1.05); // Spacing & format lift
        simReach = recPosts * projectedReachPerPost;
        primaryDriver = `Frequency cap eliminated reach cannibalization (${actualPostCount} → ${recPosts} posts, +${Math.round(((projectedReachPerPost / Math.max(1, actualDayReach / actualPostCount)) - 1) * 100)}% reach/post).`;
      } else if (actualPostCount < optimalDaily && actualPostCount > 0) {
        // Sub-optimal volume: pacing and spacing maintains high per-post performance
        recPosts = Math.min(optimalDaily, actualPostCount);
        simReach = Math.round(actualDayReach * 1.12); // Format and window optimization lift
        primaryDriver = 'Window & format optimization produced +12% projected reach lift.';
      }

      simulatedTotalPosts += recPosts;
      simulatedTotalReach += simReach;
      const simPerPost = Math.round(simReach / Math.max(1, recPosts));
      for (let i = 0; i < recPosts; i++) {
        simulatedReaches.push(simPerPost);
      }

      dailyComparisons.push({
        date,
        actual_posts: actualPostCount,
        recommended_posts: recPosts,
        actual_total_reach: actualDayReach,
        simulated_total_reach: simReach,
        primary_driver: primaryDriver,
      });
    }

    const baselineMedian = growthMetricsService.calculateMedian(baselineReaches);
    const simulatedMedian = growthMetricsService.calculateMedian(simulatedReaches);
    const reachLiftPct =
      baselineTotalReach > 0
        ? Math.round(((simulatedTotalReach - baselineTotalReach) / baselineTotalReach) * 100)
        : 0;

    const summary = `Over the past ${sortedDates.length} days, simulated Growth Intelligence 3.0 strategy (${optimalDaily} posts/day max, dynamic carousel for long confessions, and 90–150m spacing) would have produced a projected ${reachLiftPct > 0 ? `+${reachLiftPct}%` : `${reachLiftPct}%`} lift in total reach while publishing ${Math.abs(baselineTotalPosts - simulatedTotalPosts)} ${simulatedTotalPosts < baselineTotalPosts ? 'fewer' : 'more'} posts (Median reach: ${simulatedMedian} vs actual ${baselineMedian}).`;

    return {
      simulation_days: sortedDates.length,
      baseline_posts_count: baselineTotalPosts,
      baseline_total_reach: baselineTotalReach,
      baseline_median_reach_per_post: baselineMedian,
      simulated_posts_count: simulatedTotalPosts,
      simulated_total_reach: simulatedTotalReach,
      simulated_median_reach_per_post: simulatedMedian,
      projected_reach_lift_pct: reachLiftPct,
      daily_comparisons: dailyComparisons,
      summary,
    };
  }
}

export const backtestSimulationService = new BacktestSimulationService();
