/**
 * ConfessionFlow - Content Performance Scoring & Queue Prioritization Service
 * Implements data-driven predicted performance scoring, category reach modeling,
 * format multipliers, and anti-starvation aging fairness logic.
 */

import { Confession } from '@/types';
import { growthMetricsService } from './growthMetricsService';
import { mockStore } from '@/lib/mockStore';

export interface ScoredConfessionCandidate {
  confession: Confession;
  predictedPerformanceScore: number; // 0 to 100 based on intrinsic quality & category history
  agingBoost: number; // Boost points added to prevent starvation of older submissions
  effectiveScore: number; // predictedPerformanceScore + agingBoost (used for ranking)
  categoryMedianReach: number;
  factors: {
    baseQuality: number;
    categoryPerformance: number;
    formatBonus: number;
    hookStrength: number;
    lengthBonus: number;
  };
  reason: string;
}

export class ContentScoringService {
  /**
   * Score an individual confession based on quality, category history, format, and aging
   */
  public async scoreConfession(
    confession: Confession,
    allCategoryStats?: Awaited<ReturnType<typeof growthMetricsService.getCategoryGrowthStats>>
  ): Promise<ScoredConfessionCandidate> {
    const categories = allCategoryStats || (await growthMetricsService.getCategoryGrowthStats());
    const text = confession.cleaned_text || confession.original_text || '';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    // 1. Base Quality Gate Score (0–100, default 70)
    const baseQuality = typeof confession.quality_score === 'number' ? confession.quality_score : 70;

    // 2. Category Historical Performance
    const categoryName = confession.content_category || 'General';
    const catStat = categories.find((c) => c.category.toLowerCase() === categoryName.toLowerCase());
    
    // Overall account median reach across categories
    const medianReaches = categories.map((c) => c.median_reach).filter((r) => r > 0);
    const overallMedianReach = medianReaches.length > 0
      ? medianReaches.sort((a, b) => a - b)[Math.floor(medianReaches.length / 2)]
      : 1000;

    const catReach = catStat?.median_reach ?? overallMedianReach;
    const categoryRatio = overallMedianReach > 0 ? catReach / overallMedianReach : 1.0;
    // Scale to a 0–100 category factor
    const categoryPerformance = Math.min(100, Math.max(30, Math.round(50 * categoryRatio)));

    // 3. Format Multiplier
    const isCarousel = (confession.slides && confession.slides.length > 1) || confession.format === 'CAROUSEL';
    const isReel = confession.format === 'REEL';
    const formatBonus = isReel ? 95 : isCarousel ? 85 : 65;

    // 4. Hook Strength Factor
    const lower = text.toLowerCase();
    const hasQuestion = text.includes('?');
    const hasShockOrCuriosity = /^(i never told anyone|secret|nobody knows|to the person who|i can't stop thinking|confession:)/i.test(lower);
    const hookStrength = hasShockOrCuriosity ? 90 : hasQuestion ? 80 : 65;

    // 5. Length & Readability sweet spot (40–120 words performs best on social feeds)
    let lengthBonus = 70;
    if (wordCount >= 40 && wordCount <= 120) {
      lengthBonus = 90;
    } else if (wordCount >= 20 && wordCount <= 160) {
      lengthBonus = 80;
    } else if (wordCount < 10) {
      lengthBonus = 50;
    }

    // Composite Predicted Performance Score (0 - 100)
    const predictedPerformanceScore = Math.min(
      100,
      Math.max(
        10,
        Math.round(
          0.30 * baseQuality +
          0.25 * categoryPerformance +
          0.20 * formatBonus +
          0.15 * hookStrength +
          0.10 * lengthBonus
        )
      )
    );

    // 6. Anti-Starvation Aging & Fairness Logic
    // Submissions gain +1.5 points for every hour they wait in the queue (capped at +30 points).
    // This strictly prevents older approved posts from ever being starved by newer high-scoring posts.
    const createdMs = new Date(confession.created_at || Date.now()).getTime();
    const hoursWaiting = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60));
    const agingBoost = Math.min(30, Math.round(hoursWaiting * 1.5));

    const effectiveScore = Math.min(100, predictedPerformanceScore + agingBoost);

    const reason = `Predicted score: ${predictedPerformanceScore}/100 (Quality: ${baseQuality}, Category "${categoryName}": ${catReach} reach, Aging: +${agingBoost} pts for ${Math.round(hoursWaiting)}h pending).`;

    return {
      confession,
      predictedPerformanceScore,
      agingBoost,
      effectiveScore,
      categoryMedianReach: catReach,
      factors: {
        baseQuality,
        categoryPerformance,
        formatBonus,
        hookStrength,
        lengthBonus,
      },
      reason,
    };
  }

  /**
   * Rank a list of candidate confessions for scheduling prioritization
   */
  public async rankCandidates(
    candidates: Confession[],
    minQualityThreshold: number = 55
  ): Promise<ScoredConfessionCandidate[]> {
    if (candidates.length === 0) return [];

    const categoryStats = await growthMetricsService.getCategoryGrowthStats();
    const scoredList: ScoredConfessionCandidate[] = [];

    for (const c of candidates) {
      const scored = await this.scoreConfession(c, categoryStats);
      scoredList.push(scored);
    }

    // Filter out posts that do not meet the minimum quality threshold yet
    // (unless their aging boost has raised their effective score sufficiently)
    const eligible = scoredList.filter((s) => s.effectiveScore >= minQualityThreshold);

    // Sort by effectiveScore descending, breaking ties with FIFO row order
    return eligible.sort((a, b) => {
      const scoreDiff = b.effectiveScore - a.effectiveScore;
      if (Math.abs(scoreDiff) >= 3) {
        return scoreDiff;
      }
      // If scores are within 3 points of each other, maintain fair submission FIFO order
      return (a.confession.google_sheet_row || 0) - (b.confession.google_sheet_row || 0);
    });
  }
}

export const contentScoringService = new ContentScoringService();
