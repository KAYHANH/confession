-- ==============================================================================
-- ConfessionFlow - Seed Data
-- ==============================================================================

-- 1. Insert Default Templates (Classic, Dark, Minimal, Love, College, Funny, Story)
INSERT INTO templates (id, name, description, background, text_color, accent_color, font_family, font_size, show_branding, show_confession_number, show_name, layout_config, active)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Classic',
    'Clean, high-contrast monochrome with elegant Instagram crimson accents',
    'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)',
    '#111827',
    '#e1306c',
    'sans',
    44,
    true,
    true,
    true,
    '{"padding": 80, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.05}'::jsonb,
    true
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Dark Velvet',
    'Moody, sleek midnight luxury dark mode with vibrant violet glow',
    'linear-gradient(145deg, #09090b 0%, #18181b 100%)',
    '#f4f4f5',
    '#a855f7',
    'sans',
    44,
    true,
    true,
    true,
    '{"padding": 80, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.08}'::jsonb,
    true
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Minimalist Serif',
    'Art gallery editorial typography with subtle warmth and spacious margins',
    '#fafaf9',
    '#1c1917',
    '#78716c',
    'serif',
    42,
    true,
    true,
    true,
    '{"padding": 90, "quote_icon": false, "header_style": "minimal", "watermark_opacity": 0.03}'::jsonb,
    true
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Love & Romance',
    'Soft blush rose gradient designed for secret crushes, confessions, and heartbreak',
    'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 50%, #fecdd3 100%)',
    '#881337',
    '#f43f5e',
    'serif',
    44,
    true,
    true,
    true,
    '{"padding": 80, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.06}'::jsonb,
    true
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'Campus & College',
    'Energetic, modern student vibes with bold navy and electric amber tones',
    'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    '#f8fafc',
    '#f59e0b',
    'sans',
    46,
    true,
    true,
    true,
    '{"padding": 80, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.05}'::jsonb,
    true
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    'Funny & Relatable',
    'Vibrant lime & emerald pop styling for hilarious, quirky everyday incidents',
    'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    '#064e3b',
    '#10b981',
    'sans',
    44,
    true,
    true,
    true,
    '{"padding": 80, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.05}'::jsonb,
    true
  ),
  (
    '77777777-7777-7777-7777-777777777777',
    'Deep Story',
    'Immersive twilight gradient suited for reflective, emotional confessions',
    'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%)',
    '#e0e7ff',
    '#818cf8',
    'serif',
    42,
    true,
    true,
    true,
    '{"padding": 84, "quote_icon": true, "header_style": "badge", "watermark_opacity": 0.06}'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Default Settings
INSERT INTO settings (key, value)
VALUES
  ('general', '{
    "brand_name": "Campus Confessions",
    "instagram_handle": "@_hpsconfession_",
    "logo_url": "/logo.png",
    "default_template_id": "11111111-1111-1111-1111-111111111111",
    "timezone": "Asia/Kolkata"
  }'::jsonb),
  ('publishing', '{
    "auto_publish": false,
    "publishing_mode": "MANUAL_APPROVAL",
    "default_publishing_time": "19:30",
    "max_daily_posts": 10
  }'::jsonb),
  ('moderation', '{
    "enable_profanity_filter": true,
    "enable_pii_detection": true,
    "require_approval": true,
    "risk_threshold": "MEDIUM"
  }'::jsonb),
  ('hashtags', '{
    "default_hashtags": [
      "#confession",
      "#anonymousconfession",
      "#collegeconfessions",
      "#relationshipconfessions",
      "#campuslife"
    ]
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
