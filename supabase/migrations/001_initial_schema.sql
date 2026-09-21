-- ==============================================================================
-- ConfessionFlow - Initial Database Schema
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Templates Table
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  background VARCHAR(255) NOT NULL DEFAULT '#ffffff',
  text_color VARCHAR(50) NOT NULL DEFAULT '#111827',
  accent_color VARCHAR(50) NOT NULL DEFAULT '#e1306c',
  font_family VARCHAR(100) NOT NULL DEFAULT 'sans',
  font_size INTEGER NOT NULL DEFAULT 42,
  show_branding BOOLEAN NOT NULL DEFAULT true,
  show_confession_number BOOLEAN NOT NULL DEFAULT true,
  show_name BOOLEAN NOT NULL DEFAULT true,
  layout_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Confessions Table
CREATE TABLE IF NOT EXISTS confessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_sheet_id VARCHAR(255) NOT NULL DEFAULT '',
  google_sheet_name VARCHAR(255) NOT NULL DEFAULT 'Confessions',
  google_sheet_row INTEGER NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL DEFAULT 'Anonymous',
  original_text TEXT NOT NULL,
  cleaned_text TEXT NOT NULL,
  display_name VARCHAR(255) NOT NULL DEFAULT 'Anonymous',
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(50) NOT NULL DEFAULT 'NEW',
  moderation_status VARCHAR(20) NOT NULL DEFAULT 'LOW',
  moderation_reason TEXT,
  ai_processed BOOLEAN NOT NULL DEFAULT false,
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  generated_image_url TEXT,
  generated_image_path TEXT,
  caption TEXT,
  hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  instagram_media_id VARCHAR(255),
  instagram_permalink TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN (
    'NEW', 'IMPORTED', 'PROCESSING', 'READY_FOR_REVIEW',
    'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHING',
    'PUBLISHED', 'FAILED', 'FAILED_REQUIRES_ACTION'
  )),
  CONSTRAINT valid_moderation CHECK (moderation_status IN ('LOW', 'MEDIUM', 'HIGH'))
);

-- Indexes for Confessions
CREATE INDEX IF NOT EXISTS idx_confessions_status ON confessions(status);
CREATE INDEX IF NOT EXISTS idx_confessions_moderation_status ON confessions(moderation_status);
CREATE INDEX IF NOT EXISTS idx_confessions_scheduled_at ON confessions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_confessions_created_at ON confessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confessions_google_sheet_row ON confessions(google_sheet_id, google_sheet_name, google_sheet_row);
CREATE UNIQUE INDEX IF NOT EXISTS uq_confessions_sheet_row 
  ON confessions(google_sheet_id, google_sheet_name, google_sheet_row) 
  WHERE google_sheet_row > 0 AND google_sheet_id != '';

-- 3. Google Sheet Connections Table
CREATE TABLE IF NOT EXISTS google_sheet_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  spreadsheet_id VARCHAR(255) NOT NULL,
  sheet_name VARCHAR(255) NOT NULL DEFAULT 'Form Responses 1',
  column_mapping JSONB NOT NULL DEFAULT '{
    "timestampColumn": "A",
    "nameColumn": "B",
    "confessionColumn": "C",
    "statusColumn": "D",
    "postIdColumn": "E",
    "instagramUrlColumn": "F",
    "processedAtColumn": "G",
    "errorColumn": "H"
  }'::jsonb,
  service_account_email VARCHAR(255),
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(50),
  rows_imported INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Instagram Accounts Table
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Scheduled Posts Table
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confession_id UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
  scheduled_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due 
  ON scheduled_posts(scheduled_time, status) 
  WHERE status = 'PENDING';

-- 6. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- 7. Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Storage bucket note:
-- In Supabase dashboard or API, ensure 'instagram-posts' public/authenticated bucket exists.
