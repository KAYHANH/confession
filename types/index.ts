export * from './quality';
import { QualityStatus, QualityCategory, QualityDecision } from './quality';

export type ConfessionStatus =
  | 'NEW'
  | 'IMPORTED'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'FAILED_CONFIRMED'
  | 'FAILED_REQUIRES_ACTION'
  | 'UNKNOWN'
  | 'UNKNOWN_NEEDS_REVIEW'
  | 'DUPLICATE_ALREADY_PUBLISHED'
  | 'CANCELLED'
  | 'DELETED';

export type ModerationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type RecommendedAction = 'APPROVE' | 'REVIEW' | 'REJECT';

export interface Confession {
  id: string;
  google_sheet_id: string;
  google_sheet_name: string;
  google_sheet_row: number;
  name: string;
  original_text: string;
  cleaned_text: string;
  display_name: string;
  is_anonymous: boolean;
  status: ConfessionStatus;
  moderation_status: ModerationRisk;
  moderation_reason: string | null;
  ai_processed: boolean;
  template_id: string;
  generated_image_url: string | null;
  generated_image_path: string | null;
  caption: string | null;
  hashtags: string[];
  scheduled_at: string | null;
  published_at: string | null;
  deleted_at?: string | null;
  instagram_media_id: string | null;
  instagram_permalink: string | null;
  retry_count: number;
  error_message: string | null;
  // Adaptive Growth-Aware Scheduling metadata
  scheduling_strategy?: string | null;
  scheduling_gap_minutes?: number | null;
  scheduling_reason?: string | null;
  scheduling_confidence?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  scheduling_evidence_count?: number | null;
  experiment_id?: string | null;
  experiment_variant?: string | null;
  slides?: string[];
  format?: 'IMAGE' | 'CAROUSEL' | 'REEL' | 'VIDEO' | 'OTHER';
  content_category?: string;
  predicted_performance_score?: number | null;
  post_saturation_score?: number | null;
  why_this_time?: string | null;
  scheduling_provenance?: any | null;
  // Confession Quality Gate Metadata
  quality_status?: QualityStatus;
  quality_score?: number | null;
  quality_decision?: QualityDecision | null;
  quality_intent?: string | null;
  quality_reason?: string | null;
  quality_category?: QualityCategory | null;
  quality_confidence?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  quality_model_version?: string | null;
  quality_prompt_version?: string | null;
  quality_rules_version?: string | null;
  quality_analyzed_at?: string | null;
  quality_override?: boolean | null;
  quality_override_by?: string | null;
  quality_override_at?: string | null;
  quality_override_reason?: string | null;
  quality_false_positive?: boolean | null;
  quality_false_negative?: boolean | null;
  // Content Hash & Idempotency Protection
  content_hash?: string | null;
  normalized_content_hash?: string | null;
  idempotency_key?: string | null;
  publishing_attempt_id?: string | null;
  reconciliation_status?: 'RECONCILED' | 'PENDING' | 'MANUAL_REVIEW_REQUIRED' | 'NEEDS_REVIEW' | null;
  reconciliation_notes?: string | null;
  duplicate_of_id?: string | null;
  duplicate_of_row?: number | null;
  duplicate_of_permalink?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  background: string; // CSS color, gradient or image URL
  text_color: string;
  accent_color: string;
  font_family: string;
  font_size: number; // base font size in px for 1080x1080
  show_branding: boolean;
  show_confession_number: boolean;
  show_name: boolean;
  layout_config: {
    padding?: number;
    quote_icon?: boolean;
    header_style?: 'minimal' | 'badge' | 'line';
    footer_text?: string;
    watermark_opacity?: number;
  };
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  user_id?: string | null;
  action:
    | 'CONFESSION_IMPORTED'
    | 'AI_PROCESSED'
    | 'MODERATION_FLAGGED'
    | 'EDITED'
    | 'APPROVED'
    | 'REJECTED'
    | 'SCHEDULED'
    | 'PUBLISH_STARTED'
    | 'PUBLISHED'
    | 'AUTO_PUBLISHED'
    | 'PUBLISH_FAILED'
    | 'QUEUE_RESTARTED'
    | 'STALE_QUEUE_REPAIRED'
    | 'SHEET_SYNC'
    | 'INSTAGRAM_CONNECTED'
    | 'SETTINGS_UPDATED'
    | 'DELETED'
    | 'RESTORED'
    | 'QUALITY_ANALYSIS_STARTED'
    | 'QUALITY_ANALYSIS_COMPLETED'
    | 'QUALITY_REJECTED'
    | 'QUALITY_REVIEW_REQUIRED'
    | 'QUALITY_OVERRIDE'
    | 'QUALITY_DUPLICATE'
    | 'QUALITY_GIBBERISH'
    | 'QUALITY_EMOJI_ONLY'
    | 'RECONCILIATION_COMPLETED';
  entity_type: 'confession' | 'sheet' | 'instagram' | 'template' | 'settings' | 'queue' | 'system';
  entity_id?: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface PublishedPost {
  id: string;
  confession_id: string;
  confession_number: number;
  instagram_media_id: string;
  permalink: string;
  published_at: string;
  template_name?: string;
  preview_text?: string; // first ~80 chars of the confession
}

export interface ColumnMapping {
  timestampColumn: string;
  nameColumn: string;
  confessionColumn: string;
  statusColumn: string;
  postIdColumn: string;
  instagramUrlColumn: string;
  processedAtColumn: string;
  errorColumn: string;
}

export interface GoogleSheetConfig {
  id?: string;
  spreadsheet_id: string;
  sheet_name: string;
  column_mapping: ColumnMapping;
  service_account_email?: string;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  rows_imported?: number;
}

export interface InstagramAccountConfig {
  id?: string;
  account_id: string;
  username: string;
  access_token?: string;
  token_expires_at?: string | null;
  is_connected: boolean;
  has_token?: boolean;
  configured_via_env?: boolean;
  missing_env?: string[];
  status?: string;
}

export interface SystemSettings {
  brand_name: string;
  instagram_handle: string;
  logo_url: string;
  default_template_id: string;
  timezone: string;
  auto_publish: boolean;
  auto_publish_enabled?: boolean; // Frontend compatibility alias
  publishing_mode: 'MANUAL_APPROVAL' | 'AUTO_APPROVAL' | 'AUTO_PUBLISH';
  default_publishing_time: string; // e.g. "19:30"
  max_daily_posts: number; // Hard ceiling on posts per day (default 6)
  min_daily_posts?: number; // Minimum target daily posts (default 2)
  target_daily_posts?: number; // Target daily posts (default 4)
  scheduling_mode?: 'QUALITY_FIRST' | 'BALANCED' | 'HIGH_VOLUME'; // Overall scheduling strategy policy (default QUALITY_FIRST)
  content_quality_threshold?: number; // Minimum score for immediate scheduling in QUALITY_FIRST mode
  auto_publish_interval_minutes?: number; // Base cooldown between posts in minutes (e.g. 60 or 120)
  auto_publish_start_hour?: number; // Active window start hour in local time (0-23, e.g. 9 for 9 AM)
  auto_publish_end_hour?: number; // Active window end hour in local time (0-23, e.g. 23 for 11 PM)
  random_gap_enabled?: boolean; // When true, intervals vary organically between min and max gap (e.g. 45m to 95m / 1.5h)
  min_gap_minutes?: number; // Minimum organic gap in minutes (e.g. 45 min)
  max_gap_minutes?: number; // Maximum organic gap in minutes (e.g. 95 min / 1.5 hours)
  current_random_gap_minutes?: number | null; // Currently rolled dynamic gap. null = roll fresh from min/max on next cycle
  anti_bot_jitter_minutes?: number; // Anti-Bot Natural Jitter max dynamic variance (e.g. +0 to +30 min, default 30)
  current_jitter_minutes?: number; // Current dynamic variance applied to the upcoming post interval
  enable_profanity_filter: boolean;
  enable_pii_detection: boolean;
  require_approval: boolean;
  risk_threshold: ModerationRisk;
  default_hashtags: string[];
  enable_growth_intelligence?: boolean;
  enable_analytics_collection?: boolean;
  enable_reel_engine?: boolean;
  enable_growth_recommendations?: boolean;
  enable_auto_optimization?: boolean;
  enable_experiments?: boolean;
  // Adaptive Scheduling Settings
  scheduling_strategy_mode?: 'AUTO' | 'GROWTH_OPTIMIZED' | 'BASELINE' | 'MANUAL';
  manual_fixed_gap_minutes?: number;
  enable_experimental_scheduling?: boolean;
  // Content Quality Gate Settings
  enable_quality_gate?: boolean;
  auto_reject_low_value?: boolean;
  min_quality_score?: number;
  enable_groq_quality?: boolean;
  // Authority Model Settings
  min_posts_for_cadence_learning?: number; // Minimum historical posts required for Growth Intelligence authority (default 20)
  min_days_for_cadence_learning?: number; // Minimum distinct days of data required (default 7)
  min_growth_confidence?: number; // Minimum confidence required (0.0 to 1.0, default 0.70)
  rolling_horizon_hours?: number; // Rolling scheduling horizon in hours (default 24)
}

export interface ModerationCheckResult {
  risk: ModerationRisk;
  reasons: string[];
  piiDetected: {
    type: 'phone' | 'email' | 'address' | 'handle' | 'card_id';
    value: string;
    masked: string;
  }[];
  flaggedKeywords: string[];
}

export interface AIProcessedResult {
  cleanedText: string;
  displayName: string;
  caption: string;
  hashtags: string[];
  moderationRisk: ModerationRisk;
  moderationReason: string;
  recommendedAction: RecommendedAction;
}

export interface DashboardStats {
  total: number;
  pendingReview: number;
  approved: number;
  scheduled: number;
  published: number;
  rejected: number;
  failed: number;
  publishedToday: number;
  maxDailyPosts: number;
}
