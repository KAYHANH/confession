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
  views_delta?: number | null;
  reach_delta?: number | null;
  share_delta?: number | null;
  save_delta?: number | null;
  comment_delta?: number | null;
  views_velocity_per_hour?: number | null;
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
  recommendedDailyPosts?: number;
  peakHoursSummary?: {
    bestHour: number;
    secondBestHour: number;
    worstHour: number;
    bestWeekday: number;
    worstWeekday: number;
  };
  postingStrategySummary?: {
    recommendedPostsPerDay: number;
    averageGapMinutes: number;
    bestWindow: string;
    bestCategory: string;
    bestFormat: string;
    reason: string;
  };
  contentCategoryInsights?: Record<string, { medianReach: number; recommendedGapMinutes: number }>;
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

// -------------------------------------------------------------
// Account-Level Learning & Post Performance Domain Models
// -------------------------------------------------------------

export type StandardCategoryType =
  | 'relationship'
  | 'crush'
  | 'love'
  | 'friendship'
  | 'school'
  | 'college'
  | 'teacher'
  | 'funny'
  | 'emotional'
  | 'advice'
  | 'question'
  | 'drama'
  | 'controversial'
  | 'other';

export interface PostPerformanceRecord {
  post_id: string; // Internal confession ID
  instagram_media_id: string;
  content_id: string;
  published_at: string;
  format: MediaFormatType;
  media_type: string;
  confession_category: string;
  confession_subcategory?: string;
  hook_type: HookType;
  content_length: number;
  word_count: number;
  character_count: number;
  day_of_week: number; // 0 (Sun) - 6 (Sat)
  publish_hour: number; // 0 - 23
  publish_minute: number; // 0 - 59
  previous_post_gap_minutes: number;
  posts_in_previous_1h: number;
  posts_in_previous_3h: number;
  posts_in_previous_6h: number;
  posts_in_previous_24h: number;

  // Time to first observed views
  first_observed_views_at: string | null;
  minutes_until_first_observed_view: number | null;

  // Peak growth window
  peak_growth_window: string | null; // e.g. "30–60m"
  peak_growth_start_age: number | null;
  peak_growth_end_age: number | null;
  peak_growth_velocity: number | null; // views/hour
  peak_clock_window: string | null; // e.g. "8:45–9:15 PM"

  // Milestone views
  views_1h: number | null;
  views_3h: number | null;
  views_6h: number | null;
  views_12h: number | null;
  views_24h: number | null;
  views_48h: number | null;
  views_72h: number | null;
  views_7d: number | null;

  // Final observed metrics
  final_observed_views: number | null;
  final_observed_reach: number | null;
  final_observed_shares: number | null;
  final_observed_saves: number | null;
  final_observed_comments: number | null;
  final_observed_profile_visits: number | null;
  final_observed_follows: number | null;

  // Performance Index & Benchmark
  performance_index: number | null;
  percentile: number | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryDetailedGrowthStats {
  category: string;
  post_count: number;
  median_views: number;
  mean_views: number;
  median_reach: number;
  mean_reach: number;
  median_shares: number;
  median_saves: number;
  median_comments: number;
  median_profile_visits: number;
  median_follows: number;
  median_time_to_first_observed_view: number;
  median_peak_growth_velocity: number;
  median_24h_views: number;
  median_48h_views: number;
}

export interface FormatDetailedStats {
  format_type: MediaFormatType;
  sample_size: number;
  median_views: number;
  mean_views: number;
  median_reach: number;
  share_rate: number;
  save_rate: number;
  comment_rate: number;
  follow_rate: number;
  median_24h_views: number;
  median_peak_velocity: number;
  median_time_to_first_observed_view: number;
  support_state: StatisticalSupportState;
}

export interface TimeWindowDetailedStats {
  bucket_label: string; // e.g. "19:00 - 20:00" or "Fri 19:30 - 20:00"
  hour_of_day: number;
  day_of_week: number;
  window_type: '60m' | '30m' | 'day_of_week';
  sample_size: number;
  median_views: number;
  median_reach: number;
  median_shares: number;
  median_24h_views: number;
  median_peak_velocity: number;
}

export interface PostGapDetailedStats {
  gap_bucket: '0–30m' | '30–60m' | '60–90m' | '90–120m' | '120–180m' | '180m+';
  sample_size: number;
  median_views: number;
  median_reach: number;
  median_shares: number;
  median_saves: number;
  median_24h_views: number;
  median_peak_velocity: number;
  observational_finding: string;
}

export interface PostDensityStats {
  window_hours: 1 | 3 | 6 | 24;
  density_bucket: '1 post' | '2 posts' | '3 posts' | '4+ posts';
  sample_size: number;
  median_reach: number;
  median_views: number;
  median_shares: number;
}

export interface CombinationStats {
  key: string; // e.g. "Relationship + 20:00"
  category: string;
  time_window: string;
  format?: MediaFormatType;
  sample_size: number;
  median_reach: number;
  median_views: number;
  confidence: ConfidenceLevel;
}

export interface RecencyTrendItem {
  name: string;
  type: 'category' | 'format' | 'time_window';
  direction: 'RISING' | 'DECLINING' | 'STABLE';
  change_percentage: number;
  recent_sample: number;
  historical_sample: number;
  observed_summary: string;
}

export interface RecencyTrends {
  period_comparison: 'last_30_days_vs_historical';
  rising_categories: RecencyTrendItem[];
  declining_categories: RecencyTrendItem[];
  rising_formats: RecencyTrendItem[];
  declining_formats: RecencyTrendItem[];
  rising_time_windows: RecencyTrendItem[];
  declining_time_windows: RecencyTrendItem[];
}

export interface PercentileDistribution {
  p25: number;
  p50: number; // Median
  p75: number;
  p90: number;
}

export interface AccountLearningSummary {
  total_posts_analyzed: number;
  median_views: number;
  mean_views: number;
  views_distribution: PercentileDistribution;
  median_reach: number;
  mean_reach: number;
  reach_distribution: PercentileDistribution;
  median_shares: number;
  median_saves: number;
  median_comments: number;
  median_profile_visits: number;
  median_follows: number;
  median_24h_views: number;
  median_48h_views: number;
  median_peak_velocity: number;
  median_time_to_first_observed_view: number;
  best_performing_category: string;
  best_performing_format: MediaFormatType;
  best_observed_window: string; // Account publishing clock window
  best_observed_post_growth_window: string; // Post performance elapsed window (e.g. 30–60m)
  best_observed_cadence: string;
  evidence_count: number;
  confidence: ConfidenceLevel;
  disclaimer: string;
}

// -------------------------------------------------------------
// Groq AI Structured Recommendation & Decision Pipeline
// -------------------------------------------------------------

export interface GroqSchedulingRecommendation {
  strategy: string;
  recommended_format: MediaFormatType;
  recommended_category_preference?: string;
  recommended_publish_window: {
    start: string; // "19:30"
    end: string;   // "21:00"
  };
  recommended_gap_minutes: {
    min: number;
    max: number;
  };
  recommended_posts_per_3h: number;
  recommended_daily_posts?: number;
  recommended_next_publish_at: string;
  wait_before_publishing_minutes: number;
  confidence: ConfidenceLevel;
  evidence_count: number;
  reason: string;
  alternative: {
    format: MediaFormatType;
    window: string;
  };
  exploration: {
    enabled: boolean;
    percentage: number;
  };
}

export type RecommendationOutcomeType =
  | 'OUTPERFORMED_EXPECTATION'
  | 'MET_EXPECTATION'
  | 'UNDERPERFORMED_EXPECTATION'
  | 'PENDING';

export interface RecommendationRecord {
  id: string;
  content_id?: string;
  confession_row?: number;
  recommended_at: string;
  recommended_time: string;
  actual_publish_time?: string | null;
  recommended_gap: number;
  actual_gap?: number | null;
  recommended_format: MediaFormatType;
  actual_format?: MediaFormatType | null;
  expected_performance_percentile?: number | null;
  actual_performance_percentile?: number | null;
  recommendation_accuracy?: number | null;
  recommendation_outcome?: RecommendationOutcomeType;
  groq_recommendation: GroqSchedulingRecommendation;
  validation_status: 'VALIDATED' | 'ADJUSTED_FOR_SAFETY' | 'FALLBACK_BASELINE';
  applied_schedule_timestamp: string;
  status: 'PENDING' | 'ACCEPTED' | 'OVERRIDDEN' | 'MANUAL';
  notes?: string;
}

// -------------------------------------------------------------
// Posting Frequency & Saturation Analysis (Authority Model)
// -------------------------------------------------------------

export interface FrequencySaturationBucket {
  posts_per_day: number;
  sample_days: number;
  sample_posts: number;
  median_reach_per_post: number;
  mean_reach_per_post: number;
  median_total_daily_reach: number;
  median_views_per_post: number;
  median_shares_per_post: number;
  median_saves_per_post: number;
  median_engagement_rate: number;
  degradation_percent_vs_peak: number;
}

export interface FrequencySaturationAnalysis {
  buckets: FrequencySaturationBucket[];
  optimal_posts_per_day: number;
  saturation_knee_point: number | null;
  degradation_detected: boolean;
  confidence: number; // 0.00 to 1.00
  sample_size: number;
  days_of_data: number;
  summary: string;
}

export type AuthoritySource =
  | 'GROWTH_INTELLIGENCE'
  | 'SETTINGS_FALLBACK'
  | 'SETTINGS_HARD_LIMIT'
  | 'ADMIN_OVERRIDE';

export interface DailyGrowthPlan {
  date: string; // "YYYY-MM-DD"
  recommended_posts: number;
  effective_daily_posts: number;
  min_allowed_posts: number;
  max_allowed_posts: number;
  target_fallback_posts: number;
  confidence: number; // 0.00 to 1.00
  sample_size: number;
  days_of_data: number;
  is_fallback: boolean;
  authority_source: AuthoritySource;
  preferred_windows: Array<{ start: string; end: string; label?: string }>;
  recommended_spacing: {
    min_minutes: number;
    max_minutes: number;
  };
  preferred_categories: string[];
  preferred_formats: MediaFormatType[];
  reason: string;
  saturation_detected: boolean;
  saturation_knee_posts_per_day?: number;
  degradation_observed?: boolean;
  rolling_horizon_hours: number;
  generated_at: string;
}

// -------------------------------------------------------------
// Growth Intelligence 3.0: Closed-Loop Decision Engine Models
// -------------------------------------------------------------

import type { Confession } from './index';

export type GrowthDecisionType =
  | 'POST_NOW'
  | 'WAIT'
  | 'SCHEDULE'
  | 'HOLD_CONTENT'
  | 'NO_QUALIFIED_CONTENT';

export interface RealtimePostStatus {
  has_active_post: boolean;
  media_id: string | null;
  confession_id: string | null;
  confession_row?: number | null;
  published_at: string | null;
  age_minutes: number;
  current_views: number;
  current_reach: number;
  views_velocity_per_hour: number;
  historical_percentile: number; // 0 to 100
  is_accelerating: boolean;
  is_plateaued: boolean;
  should_hold_next_post: boolean;
  hold_duration_minutes_recommended: number;
  headline_alert?: string;
  message: string;
}

export interface ContentMixStrategy {
  category: string;
  historical_post_share_pct: number;
  historical_reach_share_pct: number;
  efficiency_ratio: number; // reach_share / post_share
  post_count: number;
  total_reach: number;
  recommendation: 'INCREASE' | 'MAINTAIN' | 'REDUCE';
}

export type TextLengthBracket = 'SHORT' | 'MEDIUM' | 'LONG';

export interface FormatRecommendationByLength {
  length_bracket: TextLengthBracket; // SHORT: < 40 words, MEDIUM: 40-100 words, LONG: > 100 words
  word_count_range: string;
  recommended_format: MediaFormatType;
  historical_median_reach: number;
  sample_size: number;
  comparison_notes: string;
}

export interface GrowthDecisionRationale {
  summary: string;
  factors: {
    frequency: string;
    timing: string;
    gap: string;
    real_time_velocity: string;
    format: string;
    content_mix: string;
    content_quality: string;
  };
  evidence_count: number;
}

export interface GrowthDecision {
  id: string;
  decision: GrowthDecisionType;
  candidate?: Confession | null;
  candidate_id?: string | null;
  candidate_row?: number | null;
  recommended_format: MediaFormatType;
  recommended_time: string; // ISO string
  recommended_gap_minutes: number;
  current_post_status: RealtimePostStatus | null;
  authority_source: AuthoritySource;
  confidence: ConfidenceLevel;
  confidence_score: number; // 0.0 to 1.0
  rationale: GrowthDecisionRationale;
  daily_strategy: {
    recommended_daily_posts: number;
    effective_daily_posts: number;
    min_gap_minutes: number;
    max_gap_minutes: number;
    saturation_detected: boolean;
    knee_point?: number | null;
  };
  backtest_summary?: {
    lift_pct: number;
    baseline_reach: number;
    projected_reach: number;
  };
  timestamp: string;
}

export interface BacktestDayComparison {
  date: string;
  actual_posts: number;
  recommended_posts: number;
  actual_total_reach: number;
  simulated_total_reach: number;
  primary_driver: string;
}

export interface BacktestSimulationResult {
  simulation_days: number;
  baseline_posts_count: number;
  baseline_total_reach: number;
  baseline_median_reach_per_post: number;
  simulated_posts_count: number;
  simulated_total_reach: number;
  simulated_median_reach_per_post: number;
  projected_reach_lift_pct: number;
  daily_comparisons: BacktestDayComparison[];
  summary: string;
}

