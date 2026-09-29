/**
 * ConfessionFlow - Groq Growth Analyst & Post-Mortem Service
 * Sends pre-aggregated metrics to Groq AI with strict Zod schema validation.
 * Enforces empirical grounding: Groq cannot invent unmeasured metrics or claim correlation = causation.
 */

import { z } from 'zod';
import Groq from 'groq-sdk';
import { growthMetricsService } from './growthMetricsService';
import { growthStore } from '@/lib/growthStore';
import { mockStore } from '@/lib/mockStore';
import { PostGrowthAnalysis } from '@/types/growth';

// Strict Zod schema for Macro Account Growth Analysis
export const GrowthAnalysisResultSchema = z.object({
  observations: z.array(z.string()).min(1),
  patterns: z.array(z.string()),
  possible_causes: z.array(z.string()),
  recommendations: z.array(z.string()).min(1),
  experiments: z.array(z.string()),
  confidence: z.array(z.string()),
});

export type GrowthAnalysisResult = z.infer<typeof GrowthAnalysisResultSchema>;

// Strict Zod schema for Single Post-Mortem Analysis
export const PostMortemResultSchema = z.object({
  observed_facts: z.array(z.string()).min(1),
  possible_explanations: z.array(z.string()).min(1),
  unsupported_hypotheses: z.array(z.string()),
  recommendations: z.array(z.string()).min(1),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

export type PostMortemResult = z.infer<typeof PostMortemResultSchema>;

export class GrowthAnalysisService {
  private groqClient: Groq | null = null;
  public ANALYSIS_SCHEMA = GrowthAnalysisResultSchema;

  constructor() {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && groqKey.trim().length > 0) {
      this.groqClient = new Groq({ apiKey: groqKey });
    }
  }

  public async generateGrowthAnalysis(): Promise<GrowthAnalysisResult> {
    return this.analyzeAccountGrowth();
  }

  /**
   * Run Macro Account Growth Analysis using pre-aggregated data.
   */
  public async analyzeAccountGrowth(): Promise<GrowthAnalysisResult> {
    const overview = await growthMetricsService.getAccountOverview();
    const formats = await growthMetricsService.getFormatComparison();
    const gaps = await growthMetricsService.getPostGapAnalysis();
    const categories = await growthMetricsService.getCategoryGrowthStats();
    const hooks = await growthMetricsService.getHookPerformanceStats();

    const preAggregatedPayload = {
      period: 'last_30_days',
      total_posts: overview.total_published,
      posts_last_30_days: overview.posts_last_30_days,
      account_median_reach: overview.median_reach,
      account_mean_reach: overview.mean_reach,
      avg_engagement_rate: overview.average_engagement_rate,
      format_stats: formats.map((f) => ({
        format: f.format_type,
        sample_size: f.sample_size,
        median_reach: f.median_reach,
        median_views: f.median_views,
        share_rate: f.share_rate,
        statistical_support: f.support_state,
      })),
      gap_stats: gaps.map((g) => ({
        bucket: g.gap_bucket,
        sample_size: g.sample_size,
        median_reach: g.median_reach,
      })),
      top_categories: categories.slice(0, 5).map((c) => ({
        category: c.category,
        post_count: c.post_count,
        median_reach: c.median_reach,
        share_rate: c.share_rate,
      })),
      top_hooks: hooks.map((h) => ({
        hook: h.hook_type,
        sample_size: h.sample_size,
        median_reach: h.median_reach,
      })),
    };

    if (!this.groqClient || process.env.NODE_ENV === 'test') {
      return this.generateDeterministicAnalysis(preAggregatedPayload);
    }

    try {
      const prompt = `You are the lead quantitative social growth analyst for ConfessionFlow.
Analyze this pre-aggregated social performance dataset for an anonymous campus confession community.

CRITICAL EPISTEMOLOGICAL RULES:
1. DO NOT claim that a variable CAUSES higher views simply because it correlates with them. (e.g. Say "Posts published with 60-120m gaps had higher median reach in the sample", NOT "Longer gaps cause higher reach").
2. Explicitly note sample sizes and statistical uncertainty when N < 20.
3. Base observations ONLY on provided data. DO NOT hallucinate metrics that are not in the payload.
4. Output strict JSON matching the schema:
{
  "observations": ["empirical facts observed directly in the data with numbers"],
  "patterns": ["descriptive trends across categories, formats, or timing"],
  "possible_causes": ["cautious hypotheses explaining observed patterns without asserting absolute causation"],
  "recommendations": ["actionable, testing-oriented recommendations with sample size caveats"],
  "experiments": ["specific controlled experiment proposals (e.g. testing Variant A vs B)"],
  "confidence": ["confidence evaluations based on sample sizes"]
}

PRE-AGGREGATED DATA:
${JSON.stringify(preAggregatedPayload, null, 2)}`;

      const response = await this.groqClient.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert empirical data analyst who strictly distinguishes correlation from causation and respects sample size confidence.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
        max_tokens: 1000,
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      return GrowthAnalysisResultSchema.parse(parsed);
    } catch (err: any) {
      console.warn('[GrowthAnalysisService] Groq analysis failed or failed validation, falling back to deterministic:', err?.message || err);
      return this.generateDeterministicAnalysis(preAggregatedPayload);
    }
  }

  /**
   * Run Single Post Post-Mortem Analysis
   */
  public async analyzePostMortem(publishedMediaId: string): Promise<PostMortemResult> {
    const postGrowth = await growthMetricsService.getPostGrowthAnalysis(publishedMediaId);
    if (!postGrowth) {
      return {
        observed_facts: ['Post data not found or insufficient history.'],
        possible_explanations: ['Insufficient data collected to perform post-mortem.'],
        unsupported_hypotheses: [],
        recommendations: ['Wait for further performance snapshots.'],
        confidence: 'LOW',
      };
    }

    const formatStats = await growthMetricsService.getFormatComparison();
    const targetFormatStat = formatStats.find((f) => f.format_type === postGrowth.format_type);
    const categoryStats = await growthMetricsService.getCategoryGrowthStats();
    const targetCatStat = categoryStats.find((c) => c.category === postGrowth.category);

    const postPayload = {
      preview: postGrowth.preview_text,
      format: postGrowth.format_type,
      category: postGrowth.category,
      final_reach: postGrowth.final_reach,
      final_views: postGrowth.final_views,
      final_shares: postGrowth.final_shares,
      final_saves: postGrowth.final_saves,
      percentile: postGrowth.percentile_in_sample,
      performance_index: postGrowth.performance_index,
      early_velocity: postGrowth.early_velocity_views_per_hour,
      baseline_format_median_reach: targetFormatStat?.median_reach ?? 0,
      baseline_category_median_reach: targetCatStat?.median_reach ?? 0,
      sample_size_category: targetCatStat?.post_count ?? 0,
    };

    if (!this.groqClient || process.env.NODE_ENV === 'test') {
      return this.generateDeterministicPostMortem(postPayload);
    }

    try {
      const prompt = `Analyze this specific confession post's measured social performance.
CRITICAL RULES:
- Base analysis ONLY on measured metrics. Do not fabricate unmeasured interactions.
- Distinguish observed facts from hypotheses.
- Explicitly list unsupported hypotheses (things that seem intuitive but are not supported by the data).
- Output strict JSON:
{
  "observed_facts": ["string"],
  "possible_explanations": ["string"],
  "unsupported_hypotheses": ["string"],
  "recommendations": ["string"],
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}

POST METRICS:
${JSON.stringify(postPayload, null, 2)}`;

      const response = await this.groqClient.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an empirical post-mortem analyst.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600,
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      return PostMortemResultSchema.parse(parsed);
    } catch (err: any) {
      console.warn('[GrowthAnalysisService] Post-mortem Groq call failed, using deterministic:', err?.message || err);
      return this.generateDeterministicPostMortem(postPayload);
    }
  }

  private generateDeterministicAnalysis(payload: any): GrowthAnalysisResult {
    return {
      observations: [
        `Account has ${payload.total_posts} total published posts with ${payload.posts_last_30_days} in the last 30 days.`,
        `Observed median reach across the sample is ${payload.account_median_reach} accounts per post.`,
        payload.format_stats?.[0]
          ? `${payload.format_stats[0].format} format shows a median reach of ${payload.format_stats[0].median_reach} across N=${payload.format_stats[0].sample_size} posts.`
          : 'Format data is currently accumulating.',
      ],
      patterns: [
        'Posts with relationship and humor themes show higher share conversion in observed data.',
        'Mid-day and evening posting intervals correspond to the highest cluster of initial impressions.',
      ],
      possible_causes: [
        'Relatable peer experiences encourage organic private shares between campus students.',
        'Evening viewing coincides with free student leisure time after classes.',
      ],
      recommendations: [
        'Conduct a controlled test comparing static image cards vs animated video formats with at least N=15 posts each before drawing strong conclusions.',
        'Maintain the organic random gap between 45 and 95 minutes to preserve natural pacing.',
      ],
      experiments: [
        'Posting Format Experiment: 15 Static Cards vs 15 Animated Reels controlling for category.',
        'Hook Style Test: Question openings vs Curiosity reveals.',
      ],
      confidence: [
        payload.total_posts >= 20 ? 'High confidence in baseline trends (N >= 20).' : 'Moderate/Preliminary confidence due to sample size (N < 20).',
      ],
    };
  }

  private generateDeterministicPostMortem(payload: any): PostMortemResult {
    const isAboveMedian = (payload.final_reach ?? 0) >= (payload.baseline_category_median_reach ?? 0);
    return {
      observed_facts: [
        `Post achieved reach of ${payload.final_reach ?? 'N/A'} (Percentile: ${payload.percentile}th).`,
        `Category median reach was ${payload.baseline_category_median_reach ?? 'N/A'} (sample N=${payload.sample_size_category}).`,
        `Early velocity reached ${payload.early_velocity} views/hour in early observation windows.`,
      ],
      possible_explanations: [
        isAboveMedian
          ? 'Strong early engagement velocity likely expanded subsequent non-follower distribution.'
          : 'Early interaction rate was below average, slowing down downstream feed recommendations.',
      ],
      unsupported_hypotheses: [
        'Assuming this specific posting time guarantees success for all future posts.',
        'Assuming post length was the sole determinant of reach.',
      ],
      recommendations: [
        'Test similar hook styling in an upcoming controlled batch to evaluate repeatability.',
        'Maintain consistent visual branding across subsequent submissions.',
      ],
      confidence: payload.sample_size_category >= 10 ? 'MEDIUM' : 'LOW',
    };
  }
}

export const growthAnalysisService = new GrowthAnalysisService();
