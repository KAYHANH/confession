import fs from 'fs';
import path from 'path';
import { Confession, Template, ActivityLog, GoogleSheetConfig, InstagramAccountConfig, SystemSettings, PublishedPost } from '@/types';
import { FALLBACK_INSTAGRAM_ACCOUNT_ID, FALLBACK_INSTAGRAM_ACCESS_TOKEN } from '@/lib/config';

const DATA_FILE = path.join(process.cwd(), '.mock_data.json');

export interface MockDatabase {
  confessions: Confession[];
  templates: Template[];
  activityLogs: ActivityLog[];
  publishedPosts: PublishedPost[];
  googleSheet: GoogleSheetConfig;
  instagram: InstagramAccountConfig;
  settings: SystemSettings;
  deletedRowNumbers?: number[];
}

const DEFAULT_TEMPLATES: Template[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Classic Monochrome',
    description: 'Clean, high-contrast monochrome with elegant Instagram crimson accents',
    background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)',
    text_color: '#111827',
    accent_color: '#e1306c',
    font_family: 'sans',
    font_size: 44,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80, quote_icon: true, header_style: 'badge', watermark_opacity: 0.05 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Dark Velvet',
    description: 'Moody, sleek midnight luxury dark mode with vibrant violet glow',
    background: 'linear-gradient(145deg, #09090b 0%, #18181b 100%)',
    text_color: '#f4f4f5',
    accent_color: '#a855f7',
    font_family: 'sans',
    font_size: 44,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80, quote_icon: true, header_style: 'badge', watermark_opacity: 0.08 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Minimalist Editorial',
    description: 'Art gallery editorial typography with subtle warmth and spacious margins',
    background: '#fafaf9',
    text_color: '#1c1917',
    accent_color: '#78716c',
    font_family: 'serif',
    font_size: 42,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 90, quote_icon: false, header_style: 'minimal', watermark_opacity: 0.03 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Love & Romance',
    description: 'Soft blush rose gradient designed for secret crushes, confessions, and heartbreak',
    background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 50%, #fecdd3 100%)',
    text_color: '#881337',
    accent_color: '#f43f5e',
    font_family: 'serif',
    font_size: 44,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80, quote_icon: true, header_style: 'badge', watermark_opacity: 0.06 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'Campus & College',
    description: 'Energetic, modern student vibes with bold navy and electric amber tones',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    text_color: '#f8fafc',
    accent_color: '#f59e0b',
    font_family: 'sans',
    font_size: 46,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80, quote_icon: true, header_style: 'badge', watermark_opacity: 0.05 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    name: 'Funny & Relatable',
    description: 'Vibrant lime & emerald pop styling for hilarious, quirky everyday incidents',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    text_color: '#064e3b',
    accent_color: '#10b981',
    font_family: 'sans',
    font_size: 44,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80, quote_icon: true, header_style: 'badge', watermark_opacity: 0.05 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEFAULT_SETTINGS: SystemSettings = {
  brand_name: process.env.BRAND_NAME || 'Campus Confessions',
  instagram_handle: process.env.INSTAGRAM_HANDLE || '@_hpsconfession_',
  logo_url: '/logo.png',
  default_template_id: '44444444-4444-4444-4444-444444444444',
  timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  auto_publish: process.env.NODE_ENV === 'test' ? true : false,
  publishing_mode: (process.env.NODE_ENV === 'test' ? 'AUTO_PUBLISH' : 'MANUAL_APPROVAL') as any,
  default_publishing_time: '19:30',
  max_daily_posts: parseInt(process.env.MAX_DAILY_POSTS || '6', 10),
  min_daily_posts: parseInt(process.env.MIN_DAILY_POSTS || '2', 10),
  target_daily_posts: parseInt(process.env.TARGET_DAILY_POSTS || '4', 10),
  scheduling_mode: (process.env.SCHEDULING_MODE as any) || 'QUALITY_FIRST',
  content_quality_threshold: parseInt(process.env.CONTENT_QUALITY_THRESHOLD || '60', 10),
  auto_publish_interval_minutes: parseInt(process.env.AUTO_PUBLISH_INTERVAL_MINUTES || '60', 10),
  auto_publish_start_hour: parseInt(process.env.AUTO_PUBLISH_START_HOUR || '9', 10),
  auto_publish_end_hour: parseInt(process.env.AUTO_PUBLISH_END_HOUR || '22', 10),
  random_gap_enabled: process.env.RANDOM_GAP_ENABLED !== 'false',
  min_gap_minutes: parseInt(process.env.QUEUE_RANDOM_GAP_MIN_MINUTES || process.env.MIN_GAP_MINUTES || '30', 10),
  max_gap_minutes: parseInt(process.env.QUEUE_RANDOM_GAP_MAX_MINUTES || process.env.MAX_GAP_MINUTES || '75', 10),
  current_random_gap_minutes: null, // null = roll fresh gap from min/max range on first cycle (never hardcode 60)
  anti_bot_jitter_minutes: 30,
  current_jitter_minutes: Math.floor(Math.random() * 31),
  enable_profanity_filter: true,
  enable_pii_detection: false,
  require_approval: true,
  risk_threshold: 'MEDIUM',
  default_hashtags: [
    '#confession',
    '#anonymousconfession',
    '#collegeconfessions',
    '#relationshipconfessions',
    '#campuslife',
  ],
  enable_growth_intelligence: true,  // ON by default — powers adaptive scheduling
  enable_analytics_collection: true, // ON by default — needed for Growth Intelligence data
  enable_reel_engine: false,
  enable_growth_recommendations: true,
  enable_auto_optimization: false,
  enable_experiments: false,
  scheduling_strategy_mode: (process.env.QUEUE_SCHEDULING_MODE as any) || 'AUTO',
  manual_fixed_gap_minutes: 60,
  enable_experimental_scheduling: false,
  enable_quality_gate: true,
  auto_reject_low_value: true,
  min_quality_score: 55,
  enable_groq_quality: true,
  min_posts_for_cadence_learning: parseInt(process.env.MIN_POSTS_FOR_CADENCE_LEARNING || '20', 10),
  min_days_for_cadence_learning: parseInt(process.env.MIN_DAYS_FOR_CADENCE_LEARNING || '7', 10),
  min_growth_confidence: parseFloat(process.env.MIN_GROWTH_CONFIDENCE || '0.70'),
  rolling_horizon_hours: parseInt(process.env.ROLLING_HORIZON_HOURS || '24', 10),
};

const DEFAULT_CONFESSIONS: Confession[] = [];

class MockStore {
  private data: MockDatabase;
  private lastMtime: number = 0;

  constructor() {
    this.data = this.loadData();
  }

  private ensureFresh() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      if (fs.existsSync(DATA_FILE)) {
        const stat = fs.statSync(DATA_FILE);
        if (stat.mtimeMs > this.lastMtime) {
          this.data = this.loadData();
        }
      }
    } catch {}
  }

  private loadData(): MockDatabase {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const stat = fs.statSync(DATA_FILE);
        this.lastMtime = stat.mtimeMs;
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const isTest = process.env.NODE_ENV === 'test';
        if (!parsed.instagram) {
          parsed.instagram = {};
        }
        if (!parsed.instagram.account_id) {
          parsed.instagram.account_id = process.env.INSTAGRAM_ACCOUNT_ID || (isTest ? '' : FALLBACK_INSTAGRAM_ACCOUNT_ID);
        }
        if (!parsed.instagram.access_token) {
          parsed.instagram.access_token = process.env.INSTAGRAM_ACCESS_TOKEN || (isTest ? '' : FALLBACK_INSTAGRAM_ACCESS_TOKEN);
        }
        if (!parsed.instagram.username) {
          parsed.instagram.username = process.env.INSTAGRAM_HANDLE?.replace('@', '') || '_hpsconfession_';
        }
        parsed.instagram.is_connected = !!(parsed.instagram.account_id && parsed.instagram.access_token);
        parsed.instagram.status = parsed.instagram.is_connected ? 'ACTIVE' : 'DISCONNECTED';
        if (!parsed.settings) {
          parsed.settings = { ...DEFAULT_SETTINGS };
        } else {
          // Fill in only genuinely missing fields without overriding user settings
          for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if ((parsed.settings as any)[key] === undefined) {
              (parsed.settings as any)[key] = value;
            }
          }
        }
        if (parsed.templates) {
          parsed.templates = parsed.templates.filter((t: any) => t.id !== '77777777-7777-7777-7777-777777777777');
        }
        if (parsed.settings) {
          if (!parsed.settings.default_template_id || parsed.settings.default_template_id === '77777777-7777-7777-7777-777777777777') {
            parsed.settings.default_template_id = '44444444-4444-4444-4444-444444444444';
          }
          // Auto-upgrade legacy daytime-only settings (9 to 22) to true 24/7 round-the-clock publishing (0 to 24)
          if (parsed.settings.auto_publish_start_hour === 9 && parsed.settings.auto_publish_end_hour === 22) {
            parsed.settings.auto_publish_start_hour = 0;
            parsed.settings.auto_publish_end_hour = 24;
          }
          if (parsed.settings.max_daily_posts > 6 || parsed.settings.max_daily_posts === 8 || parsed.settings.max_daily_posts === 24 || parsed.settings.max_daily_posts === 25) {
            parsed.settings.max_daily_posts = parseInt(process.env.MAX_DAILY_POSTS || '6', 10);
          }
          parsed.settings.min_daily_posts = parseInt(process.env.MIN_DAILY_POSTS || '2', 10);
          parsed.settings.target_daily_posts = parseInt(process.env.TARGET_DAILY_POSTS || '4', 10);
          if (!parsed.settings.scheduling_mode) {
            parsed.settings.scheduling_mode = 'QUALITY_FIRST';
          }
          if (process.env.AUTO_PUBLISH_ENABLED === 'false') {
            parsed.settings.auto_publish = false;
            parsed.settings.auto_publish_enabled = false;
            parsed.settings.publishing_mode = 'MANUAL_APPROVAL';
          } else if (process.env.NODE_ENV === 'test') {
            parsed.settings.auto_publish = true;
            parsed.settings.auto_publish_enabled = true;
            parsed.settings.publishing_mode = 'AUTO_PUBLISH';
          }
        }
        if (parsed.confessions) {
          parsed.confessions.forEach((c: any) => {
            if (c.template_id === '77777777-7777-7777-7777-777777777777') {
              c.template_id = '44444444-4444-4444-4444-444444444444';
            }
            // Auto-heal confessions that were trapped in static SCHEDULED state back to APPROVED
            // so they are immediately available in the active 24/7 FIFO queue
            if (c.status === 'SCHEDULED' && !c.published_at && !c.instagram_media_id) {
              c.status = 'APPROVED';
              c.scheduled_at = null;
            }
          });
        }
        if (!Array.isArray(parsed.deletedRowNumbers)) {
          parsed.deletedRowNumbers = [];
        }
        return parsed;
      }
    } catch (_e) {
      console.warn('[MockStore] Failed to read store file, using defaults');
    }

    const isTest = process.env.NODE_ENV === 'test';
    return {
      confessions: [...DEFAULT_CONFESSIONS],
      templates: [...DEFAULT_TEMPLATES],
      activityLogs: [
        {
          id: 'log-1',
          action: 'SHEET_SYNC',
          entity_type: 'sheet',
          metadata: { rows_imported: 0, sheet_name: 'Confessions' },
          created_at: new Date(Date.now() - 7200000).toISOString(),
        },
      ],
      publishedPosts: [],
      deletedRowNumbers: [],
      googleSheet: {
        spreadsheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1S5HcRCh27paVdqyiCAqAI_1x-LCABtb73R6Fisn-QJs',
        sheet_name: process.env.GOOGLE_SHEETS_SHEET_NAME || 'Confessions',
        column_mapping: {
          timestampColumn: 'A',
          nameColumn: 'B',
          confessionColumn: 'E',
          statusColumn: 'D',
          postIdColumn: 'E',
          instagramUrlColumn: 'F',
          processedAtColumn: 'G',
          errorColumn: 'H',
        },
        service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
        last_sync_at: null,
        last_sync_status: null,
        rows_imported: 0,
      },
      instagram: {
        account_id: process.env.INSTAGRAM_ACCOUNT_ID || (isTest ? '' : FALLBACK_INSTAGRAM_ACCOUNT_ID),
        username: process.env.INSTAGRAM_HANDLE?.replace('@', '') || '_hpsconfession_',
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN || (isTest ? '' : FALLBACK_INSTAGRAM_ACCESS_TOKEN),
        token_expires_at: null,
        is_connected: isTest
          ? !!(process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN)
          : true,
        status: isTest
          ? ((process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN) ? 'ACTIVE' : 'DISCONNECTED')
          : 'ACTIVE',
      },
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  public save() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
      if (fs.existsSync(DATA_FILE)) {
        this.lastMtime = fs.statSync(DATA_FILE).mtimeMs;
      }
    } catch (e) {
      console.warn('[MockStore] Failed to persist data file', e);
    }
  }

  public getConfessions(): Confession[] {
    this.ensureFresh();
    return [...this.data.confessions];
  }

  public getConfessionById(id: string): Confession | undefined {
    this.ensureFresh();
    const cleanId = String(id || '').trim();
    if (!cleanId) return undefined;
    return this.data.confessions.find(
      (c) => c.id === cleanId || String(c.id) === cleanId || (c.google_sheet_row && String(c.google_sheet_row) === cleanId)
    );
  }

  public addConfession(confession: Confession | any): Confession {
    const id = confession.id || `confession-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const fullConf: Confession = {
      ...confession,
      id,
    };
    this.data.confessions = this.data.confessions.filter((c) => c.id !== fullConf.id);
    this.data.confessions.unshift(fullConf);
    this.save();
    return fullConf;
  }

  public addConfessions(newConfessions: Confession[]) {
    const newIds = new Set(newConfessions.map((c) => c.id));
    this.data.confessions = [
      ...newConfessions,
      ...this.data.confessions.filter((c) => !newIds.has(c.id)),
    ];
    this.save();
    return newConfessions;
  }

  public setConfessions(confessions: Confession[]) {
    this.data.confessions = confessions;
    this.save();
    return this.data.confessions;
  }

  public updateConfession(id: string, updates: Partial<Confession>): Confession | null {
    this.ensureFresh();
    const cleanId = String(id || '').trim();
    const index = this.data.confessions.findIndex(
      (c) => c.id === cleanId || String(c.id) === cleanId || (c.google_sheet_row && String(c.google_sheet_row) === cleanId)
    );
    if (index === -1) return null;
    const updated = {
      ...this.data.confessions[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.data.confessions[index] = updated;
    this.save();
    return updated;
  }

  public batchUpdateConfessions(updater: (c: Confession) => Partial<Confession> | null): number {
    this.ensureFresh();
    let updatedCount = 0;
    this.data.confessions = this.data.confessions.map((c) => {
      const updates = updater(c);
      if (!updates || Object.keys(updates).length === 0) return c;
      updatedCount++;
      return {
        ...c,
        ...updates,
        updated_at: new Date().toISOString(),
      };
    });
    if (updatedCount > 0) {
      this.save();
    }
    return updatedCount;
  }

  public softDeleteConfession(id: string): boolean {
    this.ensureFresh();
    const cleanId = String(id || '').trim();
    const conf = this.data.confessions.find(
      (c) => c.id === cleanId || String(c.id) === cleanId || (c.google_sheet_row && String(c.google_sheet_row) === cleanId)
    );
    if (!conf) return false;

    conf.status = 'DELETED';
    conf.deleted_at = new Date().toISOString();
    conf.updated_at = new Date().toISOString();
    conf.scheduled_at = null; // Clear scheduled slot so it doesn't block timing

    if (conf.google_sheet_row) {
      if (!this.data.deletedRowNumbers) this.data.deletedRowNumbers = [];
      if (!this.data.deletedRowNumbers.includes(conf.google_sheet_row)) {
        this.data.deletedRowNumbers.push(conf.google_sheet_row);
      }
    }

    this.addLog({
      action: 'DELETED',
      entity_type: 'confession',
      entity_id: conf.id,
      metadata: { row: conf.google_sheet_row, text: (conf.cleaned_text || conf.original_text || '').slice(0, 60) },
    });

    this.save();
    return true;
  }

  public permanentlyDeleteConfession(id: string): boolean {
    this.ensureFresh();
    const cleanId = String(id || '').trim();
    const conf = this.data.confessions.find(
      (c) => c.id === cleanId || String(c.id) === cleanId || (c.google_sheet_row && String(c.google_sheet_row) === cleanId)
    );
    if (conf && conf.google_sheet_row) {
      if (!this.data.deletedRowNumbers) this.data.deletedRowNumbers = [];
      if (!this.data.deletedRowNumbers.includes(conf.google_sheet_row)) {
        this.data.deletedRowNumbers.push(conf.google_sheet_row);
      }
    }

    const prevLen = this.data.confessions.length;
    this.data.confessions = this.data.confessions.filter(
      (c) => c.id !== cleanId && String(c.id) !== cleanId && (!c.google_sheet_row || String(c.google_sheet_row) !== cleanId)
    );
    if (this.data.confessions.length !== prevLen) {
      this.save();
      return true;
    }
    return false;
  }

  public restoreConfession(id: string): Confession | null {
    this.ensureFresh();
    const cleanId = String(id || '').trim();
    const conf = this.data.confessions.find(
      (c) => c.id === cleanId || String(c.id) === cleanId || (c.google_sheet_row && String(c.google_sheet_row) === cleanId)
    );
    if (!conf) return null;

    conf.status = 'APPROVED';
    conf.deleted_at = null;
    conf.updated_at = new Date().toISOString();

    if (conf.google_sheet_row && this.data.deletedRowNumbers) {
      this.data.deletedRowNumbers = this.data.deletedRowNumbers.filter((r) => r !== conf.google_sheet_row);
    }

    this.addLog({
      action: 'RESTORED',
      entity_type: 'confession',
      entity_id: conf.id,
      metadata: { row: conf.google_sheet_row },
    });

    this.save();
    return conf;
  }

  public deleteConfession(id: string, permanent: boolean = false): boolean {
    if (permanent) {
      return this.permanentlyDeleteConfession(id);
    }
    return this.softDeleteConfession(id);
  }

  public getDeletedRowNumbers(): Set<number> {
    this.ensureFresh();
    return new Set(this.data.deletedRowNumbers || []);
  }

  public setDeletedRowNumbers(rows: number[]): void {
    this.data.deletedRowNumbers = [...rows];
    this.save();
  }

  public getTemplates(): Template[] {
    this.ensureFresh();
    return this.data.templates.filter((t) => t.id !== '77777777-7777-7777-7777-777777777777');
  }

  public getTemplateById(id: string): Template | undefined {
    this.ensureFresh();
    if (id === '77777777-7777-7777-7777-777777777777') {
      return this.data.templates.find((t) => t.id === '44444444-4444-4444-4444-444444444444');
    }
    return this.data.templates.find((t) => t.id === id);
  }

  public addTemplate(template: Template): Template {
    this.data.templates.push(template);
    this.save();
    return template;
  }

  public updateTemplate(id: string, updates: Partial<Template>): Template | null {
    const idx = this.data.templates.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.data.templates[idx] = {
      ...this.data.templates[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    return this.data.templates[idx];
  }

  public deleteTemplate(id: string): boolean {
    const prev = this.data.templates.length;
    this.data.templates = this.data.templates.filter((t) => t.id !== id);
    if (this.data.templates.length !== prev) {
      this.save();
      return true;
    }
    return false;
  }

  public getLogs(): ActivityLog[] {
    return [...this.data.activityLogs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public addLog(log: Omit<ActivityLog, 'id' | 'created_at'>): ActivityLog {
    const newLog: ActivityLog = {
      ...log,
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString(),
    };
    this.data.activityLogs.unshift(newLog);
    if (this.data.activityLogs.length > 500) {
      this.data.activityLogs = this.data.activityLogs.slice(0, 500);
    }
    this.save();
    return newLog;
  }

  public getPublishedPosts(): PublishedPost[] {
    if (!this.data.publishedPosts) this.data.publishedPosts = [];
    return [...this.data.publishedPosts].sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }

  public addPublishedPost(entry: Omit<PublishedPost, 'id'>): PublishedPost {
    if (!this.data.publishedPosts) this.data.publishedPosts = [];
    const newEntry: PublishedPost = {
      ...entry,
      id: `pub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
    this.data.publishedPosts.unshift(newEntry);
    // Keep max 1000 records
    if (this.data.publishedPosts.length > 1000) {
      this.data.publishedPosts = this.data.publishedPosts.slice(0, 1000);
    }
    this.save();
    return newEntry;
  }

  public getGoogleSheetConfig(): GoogleSheetConfig {
    this.ensureFresh();
    return { ...this.data.googleSheet };
  }

  public updateGoogleSheetConfig(updates: Partial<GoogleSheetConfig>): GoogleSheetConfig {
    this.ensureFresh();
    this.data.googleSheet = { ...this.data.googleSheet, ...updates };
    this.save();
    return this.data.googleSheet;
  }

  public getInstagramConfig(): InstagramAccountConfig {
    this.ensureFresh();
    const cfg = { ...this.data.instagram };
    const isTest = process.env.NODE_ENV === 'test';
    if (!isTest) {
      if (!cfg.account_id) {
        cfg.account_id = process.env.INSTAGRAM_ACCOUNT_ID || FALLBACK_INSTAGRAM_ACCOUNT_ID;
      }
      if (!cfg.access_token) {
        cfg.access_token = process.env.INSTAGRAM_ACCESS_TOKEN || FALLBACK_INSTAGRAM_ACCESS_TOKEN;
      }
      cfg.is_connected = !!(cfg.account_id && cfg.access_token);
      cfg.status = cfg.is_connected ? 'ACTIVE' : 'DISCONNECTED';
    }
    return cfg;
  }

  public updateInstagramConfig(updates: Partial<InstagramAccountConfig>): InstagramAccountConfig {
    this.ensureFresh();
    this.data.instagram = { ...this.data.instagram, ...updates };
    this.save();
    return this.data.instagram;
  }

  public getSettings(): SystemSettings {
    this.ensureFresh();
    if (!this.data.settings) {
      this.data.settings = { ...DEFAULT_SETTINGS };
      this.save();
    } else {
      // Preserve every user-configured setting! Only populate genuinely missing (undefined) keys.
      let hasMissing = false;
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if ((this.data.settings as any)[key] === undefined) {
          (this.data.settings as any)[key] = value;
          hasMissing = true;
        }
      }
      if (hasMissing) {
        this.save();
      }
    }
    if (process.env.AUTO_PUBLISH_ENABLED === 'false') {
      this.data.settings.auto_publish = false;
      this.data.settings.auto_publish_enabled = false;
      this.data.settings.publishing_mode = 'MANUAL_APPROVAL';
    }
    return { ...this.data.settings };
  }

  public updateSettings(updates: Partial<SystemSettings>): SystemSettings {
    this.ensureFresh();
    const merged = { ...this.data.settings, ...updates };
    if (updates.auto_publish === false || (updates as any).auto_publish_enabled === false) {
      merged.auto_publish = false;
      (merged as any).auto_publish_enabled = false;
      if (!merged.publishing_mode || merged.publishing_mode === 'AUTO_PUBLISH') {
        merged.publishing_mode = 'MANUAL_APPROVAL';
      }
    } else if (updates.publishing_mode === 'MANUAL_APPROVAL' || updates.publishing_mode === 'AUTO_APPROVAL') {
      merged.auto_publish = false;
      (merged as any).auto_publish_enabled = false;
    } else if (updates.auto_publish === true || (updates as any).auto_publish_enabled === true || updates.publishing_mode === 'AUTO_PUBLISH') {
      merged.auto_publish = true;
      (merged as any).auto_publish_enabled = true;
      merged.publishing_mode = 'AUTO_PUBLISH';
    }
    this.data.settings = merged;
    this.save();
    return this.data.settings;
  }

  public resetToDefaults() {
    this.data = {
      confessions: [...DEFAULT_CONFESSIONS],
      templates: [...DEFAULT_TEMPLATES],
      activityLogs: [],
      publishedPosts: [],
      googleSheet: {
        spreadsheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1S5HcRCh27paVdqyiCAqAI_1x-LCABtb73R6Fisn-QJs',
        sheet_name: process.env.GOOGLE_SHEETS_SHEET_NAME || 'Confessions',
        column_mapping: {
          timestampColumn: 'A',
          nameColumn: 'B',
          confessionColumn: 'E',
          statusColumn: 'D',
          postIdColumn: 'E',
          instagramUrlColumn: 'F',
          processedAtColumn: 'G',
          errorColumn: 'H',
        },
        service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
        last_sync_at: null,
        last_sync_status: null,
        rows_imported: 0,
      },
      instagram: {
        account_id: process.env.INSTAGRAM_ACCOUNT_ID || '',
        username: process.env.INSTAGRAM_HANDLE?.replace('@', '') || '_hpsconfession_',
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN || '',
        token_expires_at: null,
        is_connected: !!(process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN),
        status: (process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN) ? 'ACTIVE' : 'DISCONNECTED',
      },
      settings: { ...DEFAULT_SETTINGS },
    };
    this.save();
  }
}

// Global singleton instance for the Node process
const globalForMock = global as unknown as { mockStoreInstance?: MockStore };
export const mockStore = globalForMock.mockStoreInstance || new MockStore();
if (process.env.NODE_ENV !== 'production') {
  globalForMock.mockStoreInstance = mockStore;
}
