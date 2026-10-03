/**
 * ConfessionFlow - Growth Intelligence Type Definitions
 * Extensible, strongly-typed domain models for social performance, experimentation,
 * content feature analysis, and recommendation reasoning.
 */

export type MediaFormatType = 'IMAGE' | 'CAROUSEL' | 'REEL' | 'VIDEO' | 'OTHER';

export type AgeBucket =
  | '15m'
  | '30m'
  | '60m'
  | '3h'
  | '6h'
  | '12h'
  | '24h'
  | '48h'
  | '72h'
  | '7d';

export type SnapshotCollectionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type StatisticalSupportState =
  | 'INSUFFICIENT_DATA' // N < 5
  | 'PRELIMINARY'       // N 5–9
  | 'PROMISING'         // N 10–19
  | 'SUPPORTED';        // N >= 20

export type ExperimentFactor =
  | 'POSTING_TIME'
  | 'POST_GAP'
  | 'CONTENT_FORMAT'
  | 'HOOK_STYLE'
  | 'CONTENT_LENGTH'
  | 'CATEGORY'
  | 'REEL_STYLE'
  | 'AUDIO_TYPE'
  | 'CTA_STYLE';

export type HookType =
  | 'QUESTION'
  | 'SHOCK'
  | 'CURIOSITY'
  | 'CONFESSION_REVEAL'
  | 'DIRECT_STATEMENT'
  | 'STORY_OPENING'
  | 'NAME_REFERENCE'
  | 'SITUATION_SETUP';

export type EmotionalTone =
  | 'HUMOROUS'
  | 'DRAMATIC'
  | 'VULNERABLE'
  | 'ROMANTIC'
  | 'ANXIOUS'
  | 'ANGRY'
  | 'RELATABLE'
  | 'NEUTRAL';

export type ReelAnimationStyle =
  | 'FADE'
  | 'SLIDE'
  | 'TYPEWRITER'
  | 'ZOOM'
  | 'PAN'
  | 'TEXT_REVEAL'
  | 'WORD_HIGHLIGHT';

export type AudioType =
  | 'NONE'
  | 'ORIGINAL'
  | 'ROYALTY_FREE'
  | 'LICENSED'
  | 'PLATFORM_AUDIO'
  | 'OTHER';

export interface PublishedMedia {
  id: string;
  content_id: string;
  platform: 'INSTAGRAM' | 'OTHER';
  platform_media_id: string;
  platform_permalink: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  format_type: MediaFormatType;
  published_at: string;
  scheduled_at?: string | null;
  account_id: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  caption_hash?: string;
  template_id?: string | null;
  data_source: 'LIVE_COLLECTION' | 'HISTORICAL_API';
  created_at: string;
  updated_at: string;
}

export interface MediaPerformanceSnapshot {
  id: string;
  published_media_id: string;
  collected_at: string;
  target_age_minutes: number;
  actual_age_minutes: number;
  age_bucket: AgeBucket;
  views: number | null;
  plays: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  profile_visits: number | null;
  follows: number | null;
  total_watch_time_ms: number | null;
  average_watch_time_ms: number | null;
  replays: number | null;
  followers_reached: number | null;
  non_followers_reached: number | null;
  raw_metric_status: Record<string, 'AVAILABLE' | 'UNAVAILABLE' | 'ZERO'>;
  api_version: string;
  collection_status: SnapshotCollectionStatus;
  unsupported_metrics: string[];
  created_at: string;
}

export interface MetricDefinition {
  metric_name: string;
  platform: string;
  media_type: MediaFormatType;
  api_version: string;
  available: boolean;
  definition: string;
  last_verified_at: string;
}

export interface ContentFeatures {
  content_id: string;
  category: string;
  topic: string;
  subtopic?: string;
  language: string;
  language_mix: boolean;
  word_count: number;
  character_count: number;
  sentence_count: number;
  hook_length: number;
  hook_text?: string;
  hook_type: HookType;
  emotional_tone: EmotionalTone;
  question_present: boolean;
  cta_present: boolean;
  named_person: boolean;
  relationship_theme: boolean;
  school_theme: boolean;
  college_theme: boolean;
  funny_theme: boolean;
  dramatic_theme: boolean;
  negative_sentiment: number; // 0.0 - 1.0
  positive_sentiment: number; // 0.0 - 1.0
  reading_complexity: 'VERY_EASY' | 'EASY' | 'MODERATE' | 'COMPLEX';
  estimated_reading_time_seconds: number;
  sensitive_content_flag: boolean;
  feature_extraction_version: string;
  created_at: string;
}

export interface ReelVariant {
  id: string;
  content_id: string;
  source_media_id?: string | null;
  variant_name: string;
  aspect_ratio: '9:16' | '4:5' | '1:1';
  duration_ms: number;
  animation_style: ReelAnimationStyle;
  hook_style: string;
  audio_type: AudioType;
  audio_source?: string | null;
  license_metadata?: string | null;
  template_id?: string | null;
  render_path?: string | null;
  public_media_url?: string | null;
  status: 'PENDING' | 'RENDERING' | 'READY' | 'FAILED';
  error_message?: string | null;
  created_at: string;
}

export interface PostingExperiment {
  id: string;
  name: string;
  hypothesis: string;
  factor: ExperimentFactor;
  variants: {
    id: string;
    name: string;
    description: string;
    config: Record<string, any>;
  }[];
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  start_date?: string | null;
  end_date?: string | null;
  sample_size: number;
  confidence_status: StatisticalSupportState;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ExperimentAssignment {
  id: string;
  experiment_id: string;
  variant_id: string;
  content_id: string;
  published_media_id?: string | null;
  assigned_at: string;
  published_at?: string | null;
  confounders: {
    category?: string;
    format?: string;
    day_of_week?: number;
    hour?: number;
    content_length?: number;
    hook_type?: string;
    template?: string;
    special_event?: boolean;
    sensitive_content?: boolean;
    previous_post_gap_minutes?: number;
    audience_baseline?: number;
  };
  result_metrics?: {
    reach?: number | null;
    views?: number | null;
    likes?: number | null;
    shares?: number | null;
    saves?: number | null;
    comments?: number | null;
    performance_index?: number | null;
  } | null;
}

export interface GrowthRecommendation {
  id: string;
  content_id?: string | null;
  recommended_time: string;
  recommended_format: MediaFormatType;
  recommended_category?: string;
  recommended_hook_style?: string;
  recommended_content_length?: string;
  recommended_gap_range?: string;
  recommendation_confidence: ConfidenceLevel;
  evidence_count: number;
  rationale: string;
  confounders_noted: string[];
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'OVERRIDDEN';
  generated_at: string;
}

export interface RecommendationFeedback {
  id: string;
  recommendation_id: string;
  action: 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'OVERRIDDEN';
  feedback_notes?: string;
  created_at: string;
}

// -------------------------------------------------------------
// Aggregations, Performance Curves & Analytics View Models
// -------------------------------------------------------------

export interface PerformanceCurvePoint {
  age_bucket: AgeBucket;
  target_age_minutes: number;
  actual_age_minutes: number;
  cumulative_views: number;
  cumulative_reach: number;
  cumulative_shares: number;
  cumulative_saves: number;
  cumulative_likes: number;
  cumulative_comments: number;
  absolute_growth: number;
  growth_rate: number;
  percentage_growth: number;
  velocity_views_per_hour: number;
}

export interface PostGrowthAnalysis {
  published_media_id: string;
  content_id: string;
  confession_number: number;
  preview_text: string;
  format_type: MediaFormatType;
  category: string;
  published_at: string;
  performance_index: number;
  percentile_in_sample: number;
  final_reach: number | null;
  final_views: number | null;
  final_shares: number | null;
  final_saves: number | null;
  final_comments: number | null;
  curve: PerformanceCurvePoint[];
  early_velocity_views_per_hour: number;
  ai_post_mortem?: {
    observed_facts: string[];
    possible_explanations: string[];
    unsupported_hypotheses: string[];
    recommendations: string[];
    confidence: ConfidenceLevel;
  };
}

export interface FormatComparisonStats {
  format_type: MediaFormatType;
  sample_size: number;
  median_reach: number;
  mean_reach: number;
  median_views: number;
  mean_views: number;
  median_shares: number;
  median_saves: number;
  median_comments: number;
  share_rate: number;
  engagement_rate: number;
  support_state: StatisticalSupportState;
}

export interface TimeSlotStats {
  hour_of_day: number;
  day_of_week: number;
  sample_size: number;
  median_reach: number;
  mean_reach: number;
  median_views: number;
}

export interface PostGapStats {
  gap_bucket: '0-15m' | '15-30m' | '30-60m' | '60-120m' | '120-240m' | '240m+';
  sample_size: number;
  median_reach: number;
  median_views: number;
  share_rate: number;
  correlation_warning: string;
}

export interface CategoryGrowthStats {
  category: string;
  post_count: number;
  median_reach: number;
  median_views: number;
  median_shares: number;
  share_rate: number;
  comment_rate: number;
}

export interface HookPerformanceStats {
  hook_type: HookType;
  sample_size: number;
  median_reach: number;
  median_views: number;
  share_rate: number;
  support_state: StatisticalSupportState;
}

export interface AccountGrowthOverview {
  total_published: number;
  posts_last_7_days: number;
  posts_last_30_days: number;
  posts_with_snapshots?: number;
  total_snapshots?: number;
  data_status?: 'NO_DATA' | 'INSUFFICIENT_DATA' | 'DATA_AVAILABLE';
  data_availability?: 'NO_PUBLISHED_POSTS' | 'NO_SNAPSHOTS' | 'PARTIAL' | 'COMPLETE';
  status_message?: string;
  mean_reach: number;
  median_reach: number;
  mean_views: number;
  median_views: number;
  mean_shares: number;
  mean_comments: number;
  mean_saves: number;
  mean_profile_visits: number;
  median_profile_visits: number;
  average_engagement_rate: number;
  performance_index_weights: {
    reach: number;
    shares: number;
    saves: number;
    comments: number;
    profile_visits: number;
    follows: number;
  };
}

// -------------------------------------------------------------
// Adaptive Growth-Aware Scheduling Domain Types
// -------------------------------------------------------------

export type CadenceStrategyType =
  | 'BALANCED_CADENCE'
  | 'BURST_AND_COOLDOWN'
  | 'PEAK_WINDOW_PACING'
  | 'OFF_PEAK_SPACING'
  | 'EXPLORATORY_BASELINE'
  | 'EXPERIMENTAL_CADENCE'
  | 'ADMIN_OVERRIDE';

export type SchedulingMode = 'baseline' | 'growth_optimized' | 'experiment' | 'manual';

export interface PreferredPostingWindow {
  start: string; // "18:00"
  end: string;   // "21:30"
  dayOfWeek?: number; // 0-6 (0=Sunday)
  medianReach?: number;
  label?: string;
}

export interface SchedulerRecommendation {
  id: string;
  strategy: CadenceStrategyType;
  mode: SchedulingMode;
  recommendedGapRangeMinutes: {
    min: number;
    max: number;
  };
  recommendedPostsPerHour: number;
  recommendedPostsPerThreeHours: number;
  cooldownMinutes: number;
  preferredWindows: PreferredPostingWindow[];
  confidence: ConfidenceLevel;
  supportState: StatisticalSupportState;
  evidenceCount: number;
  reason: string;
  explorationAllowed: boolean;
  formatCadenceMap?: Record<string, { minGap: number; maxGap: number; reason: string }>;
  categoryCadenceMap?: Record<string, { minGap: number; maxGap: number; reason: string }>;
  viralCooldownPolicy?: {
    triggerReachMultiplier: number;
    cooldownMinutes: number;
    reason: string;
  };
  experimentId?: string;
  experimentFactor?: string;
  generated_at: string;
  version: string;
}

export interface StaleQueueRepairResult {
  repairedCount: number;
  repairedConfessions: {
    id: string;
    rowNumber: number;
    previousScheduledAt: string | null;
    newScheduledAt: string;
    gapMinutes: number;
    strategy: string;
  }[];
  strategy: CadenceStrategyType;
  reason: string;
}

