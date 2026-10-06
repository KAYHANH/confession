/**
 * ConfessionFlow - Growth Intelligence Storage Layer
 * Supports dual-mode persistence:
 * 1. Supabase Postgres when configured
 * 2. Local atomic file-backed JSON store (.mock_data.json) for dev/mock environments
 */

import fs from 'fs';
import path from 'path';
import {
  PublishedMedia,
  MediaPerformanceSnapshot,
  MetricDefinition,
  ContentFeatures,
  ReelVariant,
  PostingExperiment,
  ExperimentAssignment,
  GrowthRecommendation,
  RecommendationFeedback,
  AgeBucket,
  PostPerformanceRecord,
  RecommendationRecord,
} from '@/types/growth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const DATA_FILE = path.join(process.cwd(), '.mock_data.json');

export interface GrowthStoreData {
  publishedMedia: PublishedMedia[];
  snapshots: MediaPerformanceSnapshot[];
  metricDefinitions: MetricDefinition[];
  features: ContentFeatures[];
  reelVariants: ReelVariant[];
  experiments: PostingExperiment[];
  assignments: ExperimentAssignment[];
  recommendations: GrowthRecommendation[];
  feedback: RecommendationFeedback[];
  postPerformanceRecords: PostPerformanceRecord[];
  recommendationRecords: RecommendationRecord[];
}

const DEFAULT_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    metric_name: 'reach',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Unique accounts that have seen the media item at least once.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'views',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Total number of times the media item was viewed on screen.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'likes',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Number of likes received by the media item.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'comments',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Number of comments left on the media item.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'shares',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Number of times the media item was shared via DM or story.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'saved',
    platform: 'INSTAGRAM',
    media_type: 'IMAGE',
    api_version: 'v21.0',
    available: true,
    definition: 'Number of unique accounts that saved the media item.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'plays',
    platform: 'INSTAGRAM',
    media_type: 'REEL',
    api_version: 'v21.0',
    available: true,
    definition: 'Number of video plays started, including replays.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'total_watch_time_ms',
    platform: 'INSTAGRAM',
    media_type: 'REEL',
    api_version: 'v21.0',
    available: true,
    definition: 'Aggregate millisecond duration users spent watching the Reel.',
    last_verified_at: new Date().toISOString(),
  },
  {
    metric_name: 'replays',
    platform: 'INSTAGRAM',
    media_type: 'REEL',
    api_version: 'v21.0',
    available: true,
    definition: 'Total number of replays of the Reel.',
    last_verified_at: new Date().toISOString(),
  },
];

class GrowthStore {
  private useSupabase(): boolean {
    return (
      process.env.MOCK_EXTERNAL_APIS !== 'true' &&
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );
  }

  private readMockData(): GrowthStoreData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.growth) {
          return {
            publishedMedia: parsed.growth.publishedMedia || [],
            snapshots: parsed.growth.snapshots || [],
            metricDefinitions: parsed.growth.metricDefinitions || DEFAULT_METRIC_DEFINITIONS,
            features: parsed.growth.features || [],
            reelVariants: parsed.growth.reelVariants || [],
            experiments: parsed.growth.experiments || [],
            assignments: parsed.growth.assignments || [],
            recommendations: parsed.growth.recommendations || [],
            feedback: parsed.growth.feedback || [],
            postPerformanceRecords: parsed.growth.postPerformanceRecords || [],
            recommendationRecords: parsed.growth.recommendationRecords || [],
          };
        }
      }
    } catch (e) {
      console.warn('[GrowthStore] Could not read mock file, using defaults');
    }

    return {
      publishedMedia: [],
      snapshots: [],
      metricDefinitions: DEFAULT_METRIC_DEFINITIONS,
      features: [],
      reelVariants: [],
      experiments: [],
      assignments: [],
      recommendations: [],
      feedback: [],
      postPerformanceRecords: [],
      recommendationRecords: [],
    };
  }

  private saveMockData(data: GrowthStoreData): void {
    try {
      let rootParsed: any = {};
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        rootParsed = JSON.parse(raw);
      }
      rootParsed.growth = data;
      fs.writeFileSync(DATA_FILE, JSON.stringify(rootParsed, null, 2), 'utf-8');
    } catch (e: any) {
      console.error('[GrowthStore] Error saving growth data:', e?.message || e);
    }
  }

  // -------------------------------------------------------------
  // Published Media Methods
  // -------------------------------------------------------------
  public async getPublishedMedia(): Promise<PublishedMedia[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('published_media').select('*').order('published_at', { ascending: false });
        if (!error && data && data.length > 0) return data as PublishedMedia[];
      } catch {}
    }
    const state = this.readMockData();
    const list = state.publishedMedia || [];

    // Auto-sync published confessions from mockStore into publishedMedia
    if (typeof window === 'undefined') {
      try {
        const { mockStore } = require('./mockStore');
        const confessions = mockStore.getConfessions();
        const publishedConfessions = confessions.filter((c: any) => c.status === 'PUBLISHED' && c.instagram_media_id);
        const existingMediaIds = new Set(list.map((m: any) => m.platform_media_id));
        let changed = false;

        for (const c of publishedConfessions) {
          if (!existingMediaIds.has(c.instagram_media_id)) {
            const newMedia: PublishedMedia = {
              id: `pm-${c.id}`,
              content_id: c.id,
              platform: 'INSTAGRAM',
              platform_media_id: c.instagram_media_id,
              platform_permalink: c.instagram_permalink || '',
              media_type: 'IMAGE',
              format_type: 'IMAGE',
              published_at: c.published_at || new Date().toISOString(),
              scheduled_at: c.scheduled_at,
              account_id: mockStore.getInstagramConfig().account_id || '17841437796028856',
              status: 'ACTIVE',
              template_id: c.template_id,
              data_source: 'HISTORICAL_API',
              created_at: c.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            list.push(newMedia);
            existingMediaIds.add(c.instagram_media_id);
            changed = true;
          }
        }

        if (changed) {
          state.publishedMedia = list;
          this.saveMockData(state);
        }
      } catch {}
    }

    return list;
  }

  public async getPublishedMediaById(id: string): Promise<PublishedMedia | null> {
    const list = await this.getPublishedMedia();
    return list.find((m) => m.id === id || m.platform_media_id === id) || null;
  }

  public async getPublishedMediaByContentId(contentId: string): Promise<PublishedMedia | null> {
    const list = await this.getPublishedMedia();
    return list.find((m) => m.content_id === contentId) || null;
  }

  public async addPublishedMedia(media: PublishedMedia): Promise<PublishedMedia> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('published_media').insert(media).select().single();
        if (!error && data) return data as PublishedMedia;
      } catch {}
    }
    const state = this.readMockData();
    const existingIdx = state.publishedMedia.findIndex((m) => m.id === media.id || m.platform_media_id === media.platform_media_id);
    if (existingIdx >= 0) {
      state.publishedMedia[existingIdx] = media;
    } else {
      state.publishedMedia.unshift(media);
    }
    this.saveMockData(state);
    return media;
  }

  // -------------------------------------------------------------
  // Performance Snapshots Methods
  // -------------------------------------------------------------
  public async getSnapshots(publishedMediaId?: string): Promise<MediaPerformanceSnapshot[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        let query = supabase.from('media_performance_snapshots').select('*').order('collected_at', { ascending: true });
        if (publishedMediaId) {
          query = query.eq('published_media_id', publishedMediaId);
        }
        const { data, error } = await query;
        if (!error && data) return data as MediaPerformanceSnapshot[];
      } catch {}
    }
    const all = this.readMockData().snapshots;
    if (publishedMediaId) {
      return all.filter((s) => s.published_media_id === publishedMediaId);
    }
    return all;
  }

  public async getSnapshotsForMedia(publishedMediaId: string): Promise<MediaPerformanceSnapshot[]> {
    return this.getSnapshots(publishedMediaId);
  }

  public async getSnapshot(publishedMediaId: string, ageBucket: AgeBucket): Promise<MediaPerformanceSnapshot | null> {
    const snapshots = await this.getSnapshots(publishedMediaId);
    return snapshots.find((s) => s.published_media_id === publishedMediaId && s.age_bucket === ageBucket) || null;
  }

  public async addSnapshot(snapshot: MediaPerformanceSnapshot): Promise<MediaPerformanceSnapshot> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('media_performance_snapshots').upsert(snapshot, {
          onConflict: 'published_media_id,age_bucket',
        }).select().single();
        if (!error && data) return data as MediaPerformanceSnapshot;
      } catch {}
    }
    const state = this.readMockData();
    const existingIdx = state.snapshots.findIndex(
      (s) => s.published_media_id === snapshot.published_media_id && s.age_bucket === snapshot.age_bucket
    );
    if (existingIdx >= 0) {
      state.snapshots[existingIdx] = snapshot;
    } else {
      state.snapshots.push(snapshot);
    }
    this.saveMockData(state);
    return snapshot;
  }

  public async saveSnapshot(snapshot: MediaPerformanceSnapshot): Promise<MediaPerformanceSnapshot> {
    return this.addSnapshot(snapshot);
  }

  // -------------------------------------------------------------
  // Content Features Methods
  // -------------------------------------------------------------
  public async getContentFeatures(contentId: string): Promise<ContentFeatures | null> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('content_features').select('*').eq('content_id', contentId).maybeSingle();
        if (!error && data) return data as ContentFeatures;
      } catch {}
    }
    const all = this.readMockData().features;
    return all.find((f) => f.content_id === contentId) || null;
  }

  public async getAllContentFeatures(): Promise<ContentFeatures[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('content_features').select('*');
        if (!error && data) return data as ContentFeatures[];
      } catch {}
    }
    return this.readMockData().features;
  }

  public async saveContentFeatures(features: ContentFeatures): Promise<ContentFeatures> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('content_features').upsert(features, {
          onConflict: 'content_id',
        }).select().single();
        if (!error && data) return data as ContentFeatures;
      } catch {}
    }
    const state = this.readMockData();
    const existingIdx = state.features.findIndex((f) => f.content_id === features.content_id);
    if (existingIdx >= 0) {
      state.features[existingIdx] = features;
    } else {
      state.features.push(features);
    }
    this.saveMockData(state);
    return features;
  }

  // -------------------------------------------------------------
  // Reel Variants Methods
  // -------------------------------------------------------------
  public async getReelVariants(contentId?: string): Promise<ReelVariant[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        let query = supabase.from('reel_variants').select('*').order('created_at', { ascending: false });
        if (contentId) query = query.eq('content_id', contentId);
        const { data, error } = await query;
        if (!error && data) return data as ReelVariant[];
      } catch {}
    }
    const all = this.readMockData().reelVariants;
    if (contentId) return all.filter((r) => r.content_id === contentId);
    return all;
  }

  public async saveReelVariant(variant: ReelVariant): Promise<ReelVariant> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('reel_variants').upsert(variant).select().single();
        if (!error && data) return data as ReelVariant;
      } catch {}
    }
    const state = this.readMockData();
    const idx = state.reelVariants.findIndex((r) => r.id === variant.id);
    if (idx >= 0) {
      state.reelVariants[idx] = variant;
    } else {
      state.reelVariants.unshift(variant);
    }
    this.saveMockData(state);
    return variant;
  }

  // -------------------------------------------------------------
  // Posting Experiments Methods
  // -------------------------------------------------------------
  public async getExperiments(): Promise<PostingExperiment[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('posting_experiments').select('*').order('created_at', { ascending: false });
        if (!error && data) return data as PostingExperiment[];
      } catch {}
    }
    return this.readMockData().experiments;
  }

  public async getExperimentById(id: string): Promise<PostingExperiment | null> {
    const exps = await this.getExperiments();
    return exps.find((e) => e.id === id) || null;
  }

  public async saveExperiment(exp: PostingExperiment): Promise<PostingExperiment> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('posting_experiments').upsert(exp).select().single();
        if (!error && data) return data as PostingExperiment;
      } catch {}
    }
    const state = this.readMockData();
    const idx = state.experiments.findIndex((e) => e.id === exp.id);
    if (idx >= 0) {
      state.experiments[idx] = exp;
    } else {
      state.experiments.unshift(exp);
    }
    this.saveMockData(state);
    return exp;
  }

  public async getAssignments(experimentId?: string): Promise<ExperimentAssignment[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        let query = supabase.from('experiment_assignments').select('*');
        if (experimentId) query = query.eq('experiment_id', experimentId);
        const { data, error } = await query;
        if (!error && data) return data as ExperimentAssignment[];
      } catch {}
    }
    const all = this.readMockData().assignments;
    if (experimentId) return all.filter((a) => a.experiment_id === experimentId);
    return all;
  }

  public async saveAssignment(assignment: ExperimentAssignment): Promise<ExperimentAssignment> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('experiment_assignments').upsert(assignment).select().single();
        if (!error && data) return data as ExperimentAssignment;
      } catch {}
    }
    const state = this.readMockData();
    const idx = state.assignments.findIndex((a) => a.id === assignment.id);
    if (idx >= 0) {
      state.assignments[idx] = assignment;
    } else {
      state.assignments.push(assignment);
    }
    this.saveMockData(state);
    return assignment;
  }

  // -------------------------------------------------------------
  // Growth Recommendations & Feedback Methods
  // -------------------------------------------------------------
  public async getRecommendations(contentId?: string): Promise<GrowthRecommendation[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        let query = supabase.from('growth_recommendations').select('*').order('generated_at', { ascending: false });
        if (contentId) query = query.eq('content_id', contentId);
        const { data, error } = await query;
        if (!error && data) return data as GrowthRecommendation[];
      } catch {}
    }
    const all = this.readMockData().recommendations;
    if (contentId) return all.filter((r) => r.content_id === contentId);
    return all;
  }

  public async saveRecommendation(rec: GrowthRecommendation): Promise<GrowthRecommendation> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase.from('growth_recommendations').upsert(rec).select().single();
        if (!error && data) return data as GrowthRecommendation;
      } catch {}
    }
    const state = this.readMockData();
    const idx = state.recommendations.findIndex((r) => r.id === rec.id);
    if (idx >= 0) {
      state.recommendations[idx] = rec;
    } else {
      state.recommendations.unshift(rec);
    }
    this.saveMockData(state);
    return rec;
  }

  public async recordFeedback(feedback: RecommendationFeedback): Promise<RecommendationFeedback> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        await supabase.from('recommendation_feedback').insert(feedback);
        await supabase.from('growth_recommendations').update({ status: feedback.action }).eq('id', feedback.recommendation_id);
      } catch {}
    }
    const state = this.readMockData();
    state.feedback.push(feedback);
    const rec = state.recommendations.find((r) => r.id === feedback.recommendation_id);
    if (rec) {
      rec.status = feedback.action;
    }
    this.saveMockData(state);
    return feedback;
  }

  // -------------------------------------------------------------
  // Post Performance Records Methods
  // -------------------------------------------------------------
  public async getPostPerformanceRecords(): Promise<PostPerformanceRecord[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
          .from('post_performance_records')
          .select('*')
          .order('published_at', { ascending: false });
        if (!error && data) return data as PostPerformanceRecord[];
      } catch {}
    }
    const state = this.readMockData();
    return state.postPerformanceRecords || [];
  }

  public async getPostPerformanceRecordByPostId(postId: string): Promise<PostPerformanceRecord | null> {
    const records = await this.getPostPerformanceRecords();
    return records.find((r) => r.post_id === postId || r.content_id === postId || r.instagram_media_id === postId) || null;
  }

  public async savePostPerformanceRecord(record: PostPerformanceRecord): Promise<PostPerformanceRecord> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
          .from('post_performance_records')
          .upsert(record)
          .select()
          .single();
        if (!error && data) return data as PostPerformanceRecord;
      } catch {}
    }
    const state = this.readMockData();
    if (!state.postPerformanceRecords) state.postPerformanceRecords = [];
    const idx = state.postPerformanceRecords.findIndex((r) => r.post_id === record.post_id);
    if (idx >= 0) {
      state.postPerformanceRecords[idx] = {
        ...state.postPerformanceRecords[idx],
        ...record,
        updated_at: new Date().toISOString(),
      };
    } else {
      state.postPerformanceRecords.unshift(record);
    }
    this.saveMockData(state);
    return record;
  }

  // -------------------------------------------------------------
  // Recommendation Records Methods
  // -------------------------------------------------------------
  public async getRecommendationRecords(): Promise<RecommendationRecord[]> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
          .from('growth_recommendation_records')
          .select('*')
          .order('recommended_at', { ascending: false });
        if (!error && data) return data as RecommendationRecord[];
      } catch {}
    }
    const state = this.readMockData();
    return state.recommendationRecords || [];
  }

  public async saveRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
          .from('growth_recommendation_records')
          .upsert(record)
          .select()
          .single();
        if (!error && data) return data as RecommendationRecord;
      } catch {}
    }
    const state = this.readMockData();
    if (!state.recommendationRecords) state.recommendationRecords = [];
    const idx = state.recommendationRecords.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      state.recommendationRecords[idx] = record;
    } else {
      state.recommendationRecords.unshift(record);
    }
    this.saveMockData(state);
    return record;
  }

  public async updateRecommendationRecord(
    id: string,
    updates: Partial<RecommendationRecord>
  ): Promise<RecommendationRecord | null> {
    if (this.useSupabase()) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data, error } = await supabase
          .from('growth_recommendation_records')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        if (!error && data) return data as RecommendationRecord;
      } catch {}
    }
    const state = this.readMockData();
    if (!state.recommendationRecords) state.recommendationRecords = [];
    const idx = state.recommendationRecords.findIndex((r) => r.id === id);
    if (idx >= 0) {
      state.recommendationRecords[idx] = {
        ...state.recommendationRecords[idx],
        ...updates,
      };
      this.saveMockData(state);
      return state.recommendationRecords[idx];
    }
    return null;
  }
}

export const growthStore = new GrowthStore();
