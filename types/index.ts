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
  | 'FAILED_REQUIRES_ACTION';

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
  instagram_media_id: string | null;
  instagram_permalink: string | null;
  retry_count: number;
  error_message: string | null;
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
    | 'PUBLISH_FAILED'
    | 'SHEET_SYNC'
    | 'INSTAGRAM_CONNECTED'
    | 'SETTINGS_UPDATED';
  entity_type: 'confession' | 'sheet' | 'instagram' | 'template' | 'settings';
  entity_id?: string | null;
  metadata: Record<string, any>;
  created_at: string;
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
  status?: string;
}

export interface SystemSettings {
  brand_name: string;
  instagram_handle: string;
  logo_url: string;
  default_template_id: string;
  timezone: string;
  auto_publish: boolean;
  publishing_mode: 'MANUAL_APPROVAL' | 'AUTO_APPROVAL' | 'AUTO_PUBLISH';
  default_publishing_time: string; // e.g. "19:30"
  max_daily_posts: number;
  enable_profanity_filter: boolean;
  enable_pii_detection: boolean;
  require_approval: boolean;
  risk_threshold: ModerationRisk;
  default_hashtags: string[];
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
