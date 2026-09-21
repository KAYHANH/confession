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
    "instagram_handle": "@campusconfessions_official",
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

-- 3. Insert Demo Confessions
INSERT INTO confessions (
  id, google_sheet_id, google_sheet_name, google_sheet_row,
  name, original_text, cleaned_text, display_name, is_anonymous,
  status, moderation_status, moderation_reason, ai_processed,
  template_id, caption, hashtags, created_at
)
VALUES
  (
    'a1111111-0000-0000-0000-000000000001',
    'mock_sheet_12345', 'Confessions', 2,
    'Rahul',
    'I have liked my best friend for two years but never told her. Every time she talks about someone else my heart breaks a little.',
    'I have liked my best friend for two years, but I never told her. Every time she talks about someone else, my heart breaks a little.',
    'Rahul', false,
    'READY_FOR_REVIEW', 'LOW', 'Clear personal expression, no harm or PII detected.', true,
    '44444444-4444-4444-4444-444444444444',
    'Confession #001 💔\n\nSometimes the hardest words to say are the ones that matter the most. Would you risk a friendship to confess your feelings?\n\nShare your advice below 👇',
    ARRAY['#confession', '#crush', '#bestfriend', '#secretfeelings'],
    NOW() - INTERVAL '2 hours'
  ),
  (
    'a1111111-0000-0000-0000-000000000002',
    'mock_sheet_12345', 'Confessions', 3,
    'Anonymous',
    'I accidentally replied to my professor on email instead of my friend saying "this guy never stops giving homework bro send help". He replied with "Noted, extra assignment for you on Monday".',
    'I accidentally replied to my professor on email instead of my friend saying "this guy never stops giving homework bro send help". He replied with "Noted, extra assignment for you on Monday".',
    'Anonymous', true,
    'APPROVED', 'LOW', 'Humorous student story, zero risk.', true,
    '66666666-6666-6666-6666-666666666666',
    'Confession #002 😭💀\n\nAlways double check the "To" field before hitting send! What is your most embarrassing email blunder?\n\nDrop it in the comments below!',
    ARRAY['#collegelife', '#funnyconfession', '#studentproblems', '#oops'],
    NOW() - INTERVAL '5 hours'
  ),
  (
    'a1111111-0000-0000-0000-000000000003',
    'mock_sheet_12345', 'Confessions', 4,
    'Pooja',
    'My roommate keeps stealing my expensive coffee so I switched the coffee powder with decaf and cheap chicory. She hasn''t noticed yet and thinks the brand lost quality haha.',
    'My roommate keeps stealing my expensive coffee, so I switched the powder with decaf and cheap chicory. She hasn''t noticed yet and claims the brand lost quality!',
    'Anonymous', true,
    'SCHEDULED', 'LOW', 'Harmless petty roommate drama.', true,
    '11111111-1111-1111-1111-111111111111',
    'Confession #003 ☕\n\nPetty revenge or totally justified? What would you do if your roommate kept using your stuff without asking?\n\nTell us below 👇',
    ARRAY['#roommatediaries', '#confession', '#pettyrevenge', '#hostellife'],
    NOW() - INTERVAL '1 day'
  ),
  (
    'a1111111-0000-0000-0000-000000000004',
    'mock_sheet_12345', 'Confessions', 5,
    'Anonymous',
    'Call me at 9876543210 if you want to know what actually happened at the farewell party with Priya from CSE branch.',
    'Call me at ********10 if you want to know what actually happened at the farewell party with Priya from CSE branch.',
    'Anonymous', true,
    'READY_FOR_REVIEW', 'HIGH', 'PII detected (phone number: 9876543210, specific person identification). Masked and flagged for admin discretion.', true,
    '22222222-2222-2222-2222-222222222222',
    'Confession #004 🤫\n\nCampus rumors are swirling. Remember to keep names and private contacts out of public submissions.',
    ARRAY['#campusrumors', '#confessionflow'],
    NOW() - INTERVAL '30 minutes'
  )
ON CONFLICT (id) DO NOTHING;
