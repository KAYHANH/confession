/**
 * ConfessionFlow - Controlled Experimentation Engine
 * Enforces true experimental assignment, confounder tracking, and strict sample-size safeguards.
 * Explicitly separates active controlled trials from passive observational correlations.
 */

import {
  PostingExperiment,
  ExperimentAssignment,
  ExperimentFactor,
  StatisticalSupportState,
} from '@/types/growth';
import { growthStore } from '@/lib/growthStore';
import { Confession } from '@/types';
import { contentFeatureExtractor } from './contentFeatureExtractor';

export interface ExperimentAnalysisResult {
  experiment: PostingExperiment;
  variants: {
    variant_id: string;
    variant_name: string;
    sample_size: number;
    median_reach: number;
    mean_reach: number;
    median_views: number;
    mean_shares: number;
    support_state: StatisticalSupportState;
    confounder_distribution: Record<string, number>;
  }[];
  overall_status: StatisticalSupportState;
  leading_variant: string | null;
  evaluation_summary: string;
  confounder_warning?: string;
}

export class ExperimentService {
  /**
   * Create a new controlled experiment
   */
  public async createExperiment(data: {
    id?: string;
    name: string;
    hypothesis: string;
    factor: ExperimentFactor;
    variants?: { id: string; name: string; description: string; config: Record<string, any> }[];
    variant_a_label?: string;
    variant_b_label?: string;
    target_sample_size?: number;
    notes?: string;
  }): Promise<PostingExperiment> {
    const id = data.id || `exp-${Date.now()}`;
    const variants = data.variants || [
      { id: 'A', name: data.variant_a_label || 'Variant A', description: 'Control', config: {} },
      { id: 'B', name: data.variant_b_label || 'Variant B', description: 'Treatment', config: {} },
    ];
    const exp: PostingExperiment = {
      id,
      name: data.name,
      hypothesis: data.hypothesis,
      factor: data.factor,
      variants,
      status: 'ACTIVE',
      start_date: new Date().toISOString(),
      end_date: null,
      sample_size: 0,
      confidence_status: 'INSUFFICIENT_DATA',
      notes: data.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return await growthStore.saveExperiment(exp);
  }

  public async assignVariant(experimentId: string, confession?: Confession): Promise<string> {
    const dummyConfession: Confession = confession || {
      id: `conf-test-${Date.now()}-${Math.random()}`,
      google_sheet_id: 'test',
      google_sheet_name: 'test',
      google_sheet_row: 1,
      name: 'Test',
      original_text: 'Test content text',
      cleaned_text: 'Test content text',
      display_name: 'Test',
      is_anonymous: false,
      status: 'APPROVED',
      moderation_status: 'LOW',
      moderation_reason: null,
      ai_processed: true,
      template_id: '11111111-1111-1111-1111-111111111111',
      generated_image_url: null,
      generated_image_path: null,
      caption: null,
      hashtags: [],
      scheduled_at: null,
      published_at: null,
      instagram_media_id: null,
      instagram_permalink: null,
      retry_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const asg = await this.assignToExperiment(experimentId, dummyConfession);
    return asg?.variant_id || 'A';
  }

  /**
   * Assign a confession to an experiment variant (balanced round-robin allocation)
   */
  public async assignToExperiment(
    experimentId: string,
    confession: Confession
  ): Promise<ExperimentAssignment | null> {
    const exp = await growthStore.getExperimentById(experimentId);
    if (!exp || exp.status !== 'ACTIVE' || exp.variants.length === 0) return null;

    const existingAssignments = await growthStore.getAssignments(experimentId);

    // Count assignments per variant to maintain balance
    const counts: Record<string, number> = {};
    for (const v of exp.variants) counts[v.id] = 0;
    for (const a of existingAssignments) {
      if (counts[a.variant_id] !== undefined) counts[a.variant_id]++;
    }

    // Pick variant with lowest assignment count
    let targetVariantId = exp.variants[0].id;
    let minCount = Infinity;
    for (const v of exp.variants) {
      if (counts[v.id] < minCount) {
        minCount = counts[v.id];
        targetVariantId = v.id;
      }
    }

    // Extract confounders
    const features = await contentFeatureExtractor.extractFeatures(
      confession.id,
      confession.cleaned_text || confession.original_text
    );

    const now = new Date();
    const assignment: ExperimentAssignment = {
      id: `asg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      experiment_id: experimentId,
      variant_id: targetVariantId,
      content_id: confession.id,
      assigned_at: now.toISOString(),
      confounders: {
        category: features.category,
        format: 'IMAGE',
        day_of_week: now.getDay(),
        hour: now.getHours(),
        content_length: features.word_count,
        hook_type: features.hook_type,
        template: confession.template_id,
        sensitive_content: features.sensitive_content_flag,
      },
      result_metrics: null,
    };

    await growthStore.saveAssignment(assignment);

    // Update experiment sample size
    exp.sample_size = existingAssignments.length + 1;
    await growthStore.saveExperiment(exp);

    return assignment;
  }

  /**
   * Analyze an experiment's progress and results across variants
   */
  public async analyzeExperiment(experimentId: string): Promise<ExperimentAnalysisResult | null> {
    const exp = await growthStore.getExperimentById(experimentId);
    if (!exp) return null;

    const assignments = await growthStore.getAssignments(experimentId);
    const publishedMediaList = await growthStore.getPublishedMedia();
    const snapshots = await growthStore.getSnapshots();

    const latestSnapMap = new Map<string, any>();
    for (const s of snapshots) {
      const existing = latestSnapMap.get(s.published_media_id);
      if (!existing || s.actual_age_minutes > existing.actual_age_minutes) {
        latestSnapMap.set(s.published_media_id, s);
      }
    }

    const variantResults = exp.variants.map((v) => {
      const vAssignments = assignments.filter((a) => a.variant_id === v.id);
      const reaches: number[] = [];
      const views: number[] = [];
      const shares: number[] = [];
      const categoryCounts: Record<string, number> = {};

      for (const asg of vAssignments) {
        const cat = asg.confounders.category || 'General';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

        const pm = publishedMediaList.find((m) => m.content_id === asg.content_id);
        if (pm) {
          const snap = latestSnapMap.get(pm.id);
          if (snap) {
            if (typeof snap.reach === 'number') reaches.push(snap.reach);
            if (typeof snap.views === 'number') views.push(snap.views);
            if (typeof snap.shares === 'number') shares.push(snap.shares);
          }
        }
      }

      const sortedReaches = [...reaches].sort((a, b) => a - b);
      const medianReach =
        sortedReaches.length > 0
          ? sortedReaches[Math.floor(sortedReaches.length / 2)]
          : 0;
      const meanReach =
        reaches.length > 0 ? Math.round(reaches.reduce((a, b) => a + b, 0) / reaches.length) : 0;
      const medianViews =
        views.length > 0 ? [...views].sort((a, b) => a - b)[Math.floor(views.length / 2)] : 0;
      const meanShares =
        shares.length > 0 ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 10) / 10 : 0;

      let supportState: StatisticalSupportState = 'INSUFFICIENT_DATA';
      if (reaches.length >= 20) supportState = 'SUPPORTED';
      else if (reaches.length >= 10) supportState = 'PROMISING';
      else if (reaches.length >= 5) supportState = 'PRELIMINARY';

      return {
        variant_id: v.id,
        variant_name: v.name,
        sample_size: reaches.length,
        median_reach: medianReach,
        mean_reach: meanReach,
        median_views: medianViews,
        mean_shares: meanShares,
        support_state: supportState,
        confounder_distribution: categoryCounts,
      };
    });

    const minSample = Math.min(...variantResults.map((r) => r.sample_size), 0);
    let overallStatus: StatisticalSupportState = 'INSUFFICIENT_DATA';
    if (minSample >= 20) overallStatus = 'SUPPORTED';
    else if (minSample >= 10) overallStatus = 'PROMISING';
    else if (minSample >= 5) overallStatus = 'PRELIMINARY';

    // Leading variant
    let leadingVariant: string | null = null;
    let maxMedian = -1;
    for (const vr of variantResults) {
      if (vr.sample_size >= 5 && vr.median_reach > maxMedian) {
        maxMedian = vr.median_reach;
        leadingVariant = vr.variant_name;
      }
    }

    let summary = '';
    if (overallStatus === 'INSUFFICIENT_DATA') {
      summary = `Experiment is in early collection (minimum variant sample N=${minSample}). No statistical conclusions should be drawn until N >= 5 per variant.`;
    } else if (overallStatus === 'PRELIMINARY') {
      summary = `Preliminary evidence suggests "${leadingVariant || 'none'}" leads in median reach, but sample size (N=${minSample}) is too small to rule out random variance.`;
    } else if (overallStatus === 'PROMISING') {
      summary = `Promising separation observed for "${leadingVariant}". Sample sizes (N=${minSample}) provide moderate statistical confidence.`;
    } else {
      summary = `Supported result with robust sample sizes (N >= 20 across all variants). "${leadingVariant}" demonstrated highest median reach in this controlled trial.`;
    }

    return {
      experiment: exp,
      variants: variantResults,
      overall_status: overallStatus,
      leading_variant: leadingVariant,
      evaluation_summary: summary,
    };
  }
}

export const experimentService = new ExperimentService();
