-- Migration 004: Add DELETED status support + adaptive scheduling columns
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- This is SAFE to run multiple times (all statements use IF NOT EXISTS / DO $$ guards)

-- ─────────────────────────────────────────────────────────────────
-- 1. Add missing columns to confessions table
-- ─────────────────────────────────────────────────────────────────

-- Soft-delete tracking
ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Adaptive Growth-Aware Scheduling metadata
ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS scheduling_strategy VARCHAR(100);

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS scheduling_gap_minutes INTEGER;

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS scheduling_reason TEXT;

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS scheduling_confidence VARCHAR(10);  -- 'LOW' | 'MEDIUM' | 'HIGH'

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS scheduling_evidence_count INTEGER;

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS experiment_id VARCHAR(255);

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS experiment_variant VARCHAR(100);

-- Content metadata for format-aware scheduling
ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS slides TEXT[];   -- for CAROUSEL format

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS format VARCHAR(20);  -- 'IMAGE' | 'CAROUSEL' | 'REEL' | 'VIDEO' | 'OTHER'

ALTER TABLE confessions
  ADD COLUMN IF NOT EXISTS content_category VARCHAR(100);

-- ─────────────────────────────────────────────────────────────────
-- 2. Update the valid_status CHECK constraint to include DELETED
--    (must drop + recreate because Postgres doesn't support ALTER CONSTRAINT)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE confessions DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE confessions
  ADD CONSTRAINT valid_status CHECK (status IN (
    'NEW', 'IMPORTED', 'PROCESSING', 'READY_FOR_REVIEW',
    'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHING',
    'PUBLISHED', 'FAILED', 'FAILED_REQUIRES_ACTION', 'DELETED'
  ));

-- ─────────────────────────────────────────────────────────────────
-- 3. Add index for deleted_at for efficient deleted-section queries
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_confessions_deleted_at
  ON confessions(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_confessions_status_deleted
  ON confessions(status)
  WHERE status = 'DELETED';

-- ─────────────────────────────────────────────────────────────────
-- 4. Verify the migration applied correctly
-- ─────────────────────────────────────────────────────────────────
-- Run this SELECT after the migration to confirm:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'confessions'
-- ORDER BY ordinal_position;
