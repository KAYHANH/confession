-- ==============================================================================
-- ConfessionFlow - Migration 003: Growth Intelligence & Analytics Platform
-- Fully additive, backward-compatible schema for social optimization,
-- performance time-series snapshots, feature extraction, and experimentation.
-- ==============================================================================

-- 1. Metric Definitions Metadata Table
CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metric_name VARCHAR(100) NOT NULL,
  platform VARCHAR(50) NOT NULL DEFAULT 'INSTAGRAM',
  media_type VARCHAR(50) NOT NULL DEFAULT 'IMAGE',
  api_version VARCHAR(20) NOT NULL DEFAULT 'v21.0',
  available BOOLEAN NOT NULL DEFAULT true,
  definition TEXT,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_metric_def UNIQUE (metric_name, platform, media_type, api_version)
);

-- Seed baseline verified metrics for Meta Graph API v21.0
INSERT INTO metric_definitions (metric_name, platform, media_type, api_version, available, definition)
VALUES 
  ('reach', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Unique accounts that have seen the media item at least once.'),
  ('views', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Total number of times the media item was viewed on screen.'),
  ('likes', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Number of likes received by the media item.'),
  ('comments', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Number of comments left on the media item.'),
  ('shares', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Number of times the media item was shared via direct message or story.'),
  ('saved', 'INSTAGRAM', 'IMAGE', 'v21.0', true, 'Number of unique accounts that saved the media item.'),
  ('plays', 'INSTAGRAM', 'REEL', 'v21.0', true, 'Number of video plays started, including replays.'),
  ('total_watch_time_ms', 'INSTAGRAM', 'REEL', 'v21.0', true, 'Aggregate millisecond duration users spent watching the Reel.'),
  ('replays', 'INSTAGRAM', 'REEL', 'v21.0', true, 'Total number of replays of the Reel.')
ON CONFLICT (metric_name, platform, media_type, api_version) DO NOTHING;

-- 2. Published Media Table
CREATE TABLE IF NOT EXISTS published_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES confessions(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL DEFAULT 'INSTAGRAM',
  platform_media_id VARCHAR(255) NOT NULL,
  platform_permalink TEXT NOT NULL,
  media_type VARCHAR(50) NOT NULL DEFAULT 'IMAGE',
  format_type VARCHAR(50) NOT NULL DEFAULT 'IMAGE',
  published_at TIMESTAMPTZ NOT NULL,
  scheduled_at TIMESTAMPTZ,
  account_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  caption_hash VARCHAR(64),
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  data_source VARCHAR(50) NOT NULL DEFAULT 'LIVE_COLLECTION',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_format_type CHECK (format_type IN ('IMAGE', 'CAROUSEL', 'REEL', 'VIDEO', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_published_media_content_id ON published_media(content_id);
CREATE INDEX IF NOT EXISTS idx_published_media_published_at ON published_media(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_media_format_type ON published_media(format_type);
CREATE INDEX IF NOT EXISTS idx_published_media_platform_id ON published_media(platform_media_id);

-- 3. Media Performance Snapshots Table (Time-Series)
CREATE TABLE IF NOT EXISTS media_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  published_media_id UUID NOT NULL REFERENCES published_media(id) ON DELETE CASCADE,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  target_age_minutes INTEGER NOT NULL,
  actual_age_minutes INTEGER NOT NULL,
  age_bucket VARCHAR(20) NOT NULL,
  views BIGINT,
  plays BIGINT,
  reach BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  profile_visits BIGINT,
  follows BIGINT,
  total_watch_time_ms BIGINT,
  average_watch_time_ms BIGINT,
  replays BIGINT,
  followers_reached BIGINT,
  non_followers_reached BIGINT,
  raw_metric_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_version VARCHAR(20) NOT NULL DEFAULT 'v21.0',
  collection_status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  unsupported_metrics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_age_bucket CHECK (age_bucket IN ('15m', '30m', '60m', '3h', '6h', '12h', '24h', '48h', '72h', '7d')),
  CONSTRAINT valid_collection_status CHECK (collection_status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  CONSTRAINT uq_snapshot_bucket UNIQUE (published_media_id, age_bucket)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_media_id ON media_performance_snapshots(published_media_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_collected_at ON media_performance_snapshots(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_age_bucket ON media_performance_snapshots(age_bucket);

-- 4. Content Features Table (NLP and Semantic Profiling)
CREATE TABLE IF NOT EXISTS content_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  topic VARCHAR(255) NOT NULL DEFAULT 'General',
  subtopic VARCHAR(255),
  language VARCHAR(20) NOT NULL DEFAULT 'en',
  language_mix BOOLEAN NOT NULL DEFAULT false,
  word_count INTEGER NOT NULL DEFAULT 0,
  character_count INTEGER NOT NULL DEFAULT 0,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  hook_length INTEGER NOT NULL DEFAULT 0,
  hook_text TEXT,
  hook_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT_STATEMENT',
  emotional_tone VARCHAR(50) NOT NULL DEFAULT 'RELATABLE',
  question_present BOOLEAN NOT NULL DEFAULT false,
  cta_present BOOLEAN NOT NULL DEFAULT false,
  named_person BOOLEAN NOT NULL DEFAULT false,
  relationship_theme BOOLEAN NOT NULL DEFAULT false,
  school_theme BOOLEAN NOT NULL DEFAULT false,
  college_theme BOOLEAN NOT NULL DEFAULT false,
  funny_theme BOOLEAN NOT NULL DEFAULT false,
  dramatic_theme BOOLEAN NOT NULL DEFAULT false,
  negative_sentiment NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  positive_sentiment NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  reading_complexity VARCHAR(20) NOT NULL DEFAULT 'EASY',
  estimated_reading_time_seconds INTEGER NOT NULL DEFAULT 10,
  sensitive_content_flag BOOLEAN NOT NULL DEFAULT false,
  feature_extraction_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_features UNIQUE (content_id)
);

CREATE INDEX IF NOT EXISTS idx_content_features_content_id ON content_features(content_id);
CREATE INDEX IF NOT EXISTS idx_content_features_category ON content_features(category);
CREATE INDEX IF NOT EXISTS idx_content_features_hook_type ON content_features(hook_type);

-- 5. Reel Variants Table
CREATE TABLE IF NOT EXISTS reel_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
  source_media_id UUID REFERENCES published_media(id) ON DELETE SET NULL,
  variant_name VARCHAR(100) NOT NULL,
  aspect_ratio VARCHAR(20) NOT NULL DEFAULT '9:16',
  duration_ms INTEGER NOT NULL DEFAULT 8000,
  animation_style VARCHAR(50) NOT NULL DEFAULT 'FADE',
  hook_style VARCHAR(100) NOT NULL DEFAULT 'Curiosity',
  audio_type VARCHAR(50) NOT NULL DEFAULT 'NONE',
  audio_source TEXT,
  license_metadata TEXT,
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  render_path TEXT,
  public_media_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reel_variants_content_id ON reel_variants(content_id);
CREATE INDEX IF NOT EXISTS idx_reel_variants_status ON reel_variants(status);

-- 6. Posting Experiments Table
CREATE TABLE IF NOT EXISTS posting_experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  hypothesis TEXT NOT NULL,
  factor VARCHAR(50) NOT NULL,
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence_status VARCHAR(50) NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_experiment_factor CHECK (factor IN (
    'POSTING_TIME', 'POST_GAP', 'CONTENT_FORMAT', 'HOOK_STYLE',
    'CONTENT_LENGTH', 'CATEGORY', 'REEL_STYLE', 'AUDIO_TYPE', 'CTA_STYLE'
  )),
  CONSTRAINT valid_exp_confidence CHECK (confidence_status IN (
    'INSUFFICIENT_DATA', 'PRELIMINARY', 'PROMISING', 'SUPPORTED'
  ))
);

-- 7. Experiment Assignments Table
CREATE TABLE IF NOT EXISTS experiment_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID NOT NULL REFERENCES posting_experiments(id) ON DELETE CASCADE,
  variant_id VARCHAR(100) NOT NULL,
  content_id UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
  published_media_id UUID REFERENCES published_media(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  confounders JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exp_assignments_exp_id ON experiment_assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_exp_assignments_content_id ON experiment_assignments(content_id);

-- 8. Growth Recommendations Table
CREATE TABLE IF NOT EXISTS growth_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES confessions(id) ON DELETE CASCADE,
  recommended_time VARCHAR(20) NOT NULL,
  recommended_format VARCHAR(50) NOT NULL DEFAULT 'IMAGE',
  recommended_category VARCHAR(100),
  recommended_hook_style VARCHAR(100),
  recommended_content_length VARCHAR(50),
  recommended_gap_range VARCHAR(50),
  recommendation_confidence VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  rationale TEXT NOT NULL,
  confounders_noted TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_rec_confidence CHECK (recommendation_confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  CONSTRAINT valid_rec_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'IGNORED', 'OVERRIDDEN'))
);

CREATE INDEX IF NOT EXISTS idx_recommendations_content_id ON growth_recommendations(content_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON growth_recommendations(status);

-- 9. Recommendation Feedback Table
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recommendation_id UUID NOT NULL REFERENCES growth_recommendations(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  feedback_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Daily Pre-Aggregates Table for Dashboard Caching
CREATE TABLE IF NOT EXISTS daily_growth_aggregates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE UNIQUE NOT NULL,
  total_posts INTEGER NOT NULL DEFAULT 0,
  total_reach BIGINT NOT NULL DEFAULT 0,
  total_views BIGINT NOT NULL DEFAULT 0,
  median_reach INTEGER NOT NULL DEFAULT 0,
  median_views INTEGER NOT NULL DEFAULT 0,
  median_shares INTEGER NOT NULL DEFAULT 0,
  format_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
