import fs from 'fs';
import path from 'path';
import { Confession, Template, ActivityLog, GoogleSheetConfig, InstagramAccountConfig, SystemSettings, PublishedPost } from '@/types';

const DATA_FILE = path.join(process.cwd(), '.mock_data.json');

export interface MockDatabase {
  confessions: Confession[];
  templates: Template[];
  activityLogs: ActivityLog[];
  publishedPosts: PublishedPost[];
  googleSheet: GoogleSheetConfig;
  instagram: InstagramAccountConfig;
  settings: SystemSettings;
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
  {
    id: '77777777-7777-7777-7777-777777777777',
    name: 'Deep Story',
    description: 'Immersive twilight gradient suited for reflective, emotional confessions',
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%)',
    text_color: '#e0e7ff',
    accent_color: '#818cf8',
    font_family: 'serif',
    font_size: 42,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 84, quote_icon: true, header_style: 'badge', watermark_opacity: 0.06 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEFAULT_SETTINGS: SystemSettings = {
  brand_name: process.env.BRAND_NAME || 'Campus Confessions',
  instagram_handle: process.env.INSTAGRAM_HANDLE || '@_hpsconfession_',
  logo_url: '/logo.png',
  default_template_id: '77777777-7777-7777-7777-777777777777',
  timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  auto_publish: process.env.AUTO_PUBLISH_ENABLED === 'true',
  publishing_mode: 'MANUAL_APPROVAL',
  default_publishing_time: '19:30',
  max_daily_posts: parseInt(process.env.MAX_DAILY_POSTS || '15', 10),
  auto_publish_interval_minutes: parseInt(process.env.AUTO_PUBLISH_INTERVAL_MINUTES || '120', 10),
  auto_publish_start_hour: 9,
  auto_publish_end_hour: 23,
  enable_profanity_filter: true,
  enable_pii_detection: true,
  require_approval: true,
  risk_threshold: 'MEDIUM',
  default_hashtags: [
    '#confession',
    '#anonymousconfession',
    '#collegeconfessions',
    '#relationshipconfessions',
    '#campuslife',
  ],
};

const DEFAULT_CONFESSIONS: Confession[] = [];

class MockStore {
  private data: MockDatabase;
  private lastMtime: number = 0;

  constructor() {
    this.data = this.loadData();
  }

  private ensureFresh() {
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
        if (!parsed.instagram?.account_id && process.env.INSTAGRAM_ACCOUNT_ID) {
          parsed.instagram.account_id = process.env.INSTAGRAM_ACCOUNT_ID;
        }
        if (!parsed.instagram?.access_token && process.env.INSTAGRAM_ACCESS_TOKEN) {
          parsed.instagram.access_token = process.env.INSTAGRAM_ACCESS_TOKEN;
        }
        return parsed;
      }
    } catch (_e) {
      console.warn('[MockStore] Failed to read store file, using defaults');
    }

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
  }

  public save() {
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
    return this.data.confessions.find((c) => c.id === id);
  }

  public addConfession(confession: Confession) {
    this.data.confessions.unshift(confession);
    this.save();
    return confession;
  }

  public addConfessions(newConfessions: Confession[]) {
    this.data.confessions = [...newConfessions, ...this.data.confessions];
    this.save();
    return newConfessions;
  }

  public setConfessions(confessions: Confession[]) {
    this.data.confessions = confessions;
    this.save();
    return this.data.confessions;
  }

  public updateConfession(id: string, updates: Partial<Confession>): Confession | null {
    const index = this.data.confessions.findIndex((c) => c.id === id);
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

  public deleteConfession(id: string): boolean {
    const prevLen = this.data.confessions.length;
    this.data.confessions = this.data.confessions.filter((c) => c.id !== id);
    if (this.data.confessions.length !== prevLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getTemplates(): Template[] {
    return [...this.data.templates];
  }

  public getTemplateById(id: string): Template | undefined {
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
    return { ...this.data.instagram };
  }

  public updateInstagramConfig(updates: Partial<InstagramAccountConfig>): InstagramAccountConfig {
    this.ensureFresh();
    this.data.instagram = { ...this.data.instagram, ...updates };
    this.save();
    return this.data.instagram;
  }

  public getSettings(): SystemSettings {
    this.ensureFresh();
    return { ...this.data.settings };
  }

  public updateSettings(updates: Partial<SystemSettings>): SystemSettings {
    this.ensureFresh();
    this.data.settings = { ...this.data.settings, ...updates };
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
