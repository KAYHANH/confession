'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Settings as SettingsIcon,
  FileSpreadsheet,
  Instagram,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Send,
  Hash,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Video,
  BarChart3,
  FlaskConical,
  Zap,
  Activity,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SystemSettings, GoogleSheetConfig, InstagramAccountConfig } from '@/types';
import { SchedulerRecommendation, DailyGrowthPlan } from '@/types/growth';
import { useToast } from '@/components/ui/ToastContext';

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'general';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Configuration States
  const [generalSettings, setGeneralSettings] = useState<SystemSettings | null>(null);
  const [sheetConfig, setSheetConfig] = useState<GoogleSheetConfig | null>(null);
  const [instagramConfig, setInstagramConfig] = useState<InstagramAccountConfig | null>(null);
  const [cadenceRec, setCadenceRec] = useState<SchedulerRecommendation | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyGrowthPlan | null>(null);

  // Test Connection States
  const [testingSheet, setTestingSheet] = useState(false);
  const [sheetTestMessage, setSheetTestMessage] = useState<{ success: boolean; text: string } | null>(null);

  const [testingInstagram, setTestingInstagram] = useState(false);
  const [instagramTestMessage, setInstagramTestMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [testingAnalytics, setTestingAnalytics] = useState(false);
  const [analyticsTestMessage, setAnalyticsTestMessage] = useState<{ success: boolean; text: string } | null>(null);

  const { success, error, info } = useToast();
  const [runningAutoPublish, setRunningAutoPublish] = useState(false);

  const handleTriggerAutoPublish = async (force: boolean = true) => {
    setRunningAutoPublish(true);
    try {
      const res = await fetch('/api/cron/auto-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-publish execution failed');
      if (data.status === 'SUCCESS') {
        success(`Auto-publish succeeded! Published confession #${data.confessionNumber}`);
      } else {
        info(data.reason || `Auto-publish status: ${data.status}`);
      }
      window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
    } catch (err: any) {
      error(err?.message || 'Failed to trigger auto-publish');
    } finally {
      setRunningAutoPublish(false);
    }
  };

  const loadAllSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [genRes, sheetRes, igRes, cadenceRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/sheets/status'),
        fetch('/api/instagram/status'),
        fetch('/api/growth/cadence').catch(() => null),
      ]);

      const [genData, sheetData, igData] = await Promise.all([
        genRes.json(),
        sheetRes.json(),
        igRes.json(),
      ]);

      if (cadenceRes && cadenceRes.ok) {
        try {
          const cData = await cadenceRes.json();
          if (cData.success) {
            if (cData.recommendation) setCadenceRec(cData.recommendation);
            if (cData.dailyPlan) setDailyPlan(cData.dailyPlan);
          }
        } catch {}
      }

      if (!genRes.ok) {
        error(genData?.error || 'Failed to load settings');
        return;
      }

      // Check browser localStorage for persistent user preference backups
      let effectiveGenData = genData;
      if (typeof window !== 'undefined') {
        const localBackup = localStorage.getItem('confessionflow_custom_settings');
        if (localBackup) {
          try {
            const parsed = JSON.parse(localBackup);
            if (parsed.auto_publish === false || parsed.auto_publish_enabled === false) {
              parsed.auto_publish = false;
              parsed.auto_publish_enabled = false;
              if (!parsed.publishing_mode || parsed.publishing_mode === 'AUTO_PUBLISH') {
                parsed.publishing_mode = 'MANUAL_APPROVAL';
              }
            } else if (parsed.publishing_mode === 'MANUAL_APPROVAL' || parsed.publishing_mode === 'AUTO_APPROVAL') {
              parsed.auto_publish = false;
              parsed.auto_publish_enabled = false;
            }
            const needsSync = Object.entries(parsed).some(
              ([k, v]) => v !== undefined && v !== (genData as any)[k]
            );
            if (needsSync) {
              effectiveGenData = { ...genData, ...parsed };
              // Sync back to server in background so server adopts user's persistent choices
              fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(effectiveGenData),
              }).catch(() => {});
            }
          } catch {}
        } else {
          localStorage.setItem('confessionflow_custom_settings', JSON.stringify(genData));
        }
      }

      setGeneralSettings(effectiveGenData);
      setSheetConfig(sheetData);
      setInstagramConfig(igData);
    } catch {
      error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [error]);

  const handleUpdateCadenceOverride = async (mode: 'AUTO' | 'BASELINE' | 'MANUAL', fixedGap?: number) => {
    setSaving(true);
    try {
      const res = await fetch('/api/growth/cadence/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, fixedGapMinutes: fixedGap }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update cadence mode');
      setCadenceRec(data.recommendation);
      success(`Scheduling mode set to ${mode}`);
      loadAllSettings();
    } catch (err: any) {
      error(err?.message || 'Failed to update scheduling mode');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadAllSettings();
  }, [loadAllSettings]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) setActiveTab(tabParam);
  }, [searchParams]);

  // Save General & Publishing & Moderation Settings (with dual server + localStorage persistence)
  const handleSaveGeneral = async (updates: Partial<SystemSettings>, silent: boolean = false) => {
    if (!silent) setSaving(true);
    try {
      // 1. Immediately persist to localStorage
      if (typeof window !== 'undefined') {
        const existing = localStorage.getItem('confessionflow_custom_settings');
        const currentLocal = existing ? JSON.parse(existing) : {};
        const newBackup = { ...currentLocal, ...updates };
        localStorage.setItem('confessionflow_custom_settings', JSON.stringify(newBackup));
      }

      // 2. Persist to server
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update settings');
      }
      const saved = await res.json();
      setGeneralSettings(saved);
      if (typeof window !== 'undefined') {
        localStorage.setItem('confessionflow_custom_settings', JSON.stringify(saved));
      }
      if (!silent) success('Settings saved permanently as default!');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
      }
    } catch (err: any) {
      error(err?.message || 'Error saving settings');
    } finally {
      if (!silent) setSaving(false);
    }
  };

  // Instant auto-save helper for toggles, selects, and inputs
  const updateSettingField = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    if (!generalSettings) return;
    const updated = { ...generalSettings, [key]: value };
    setGeneralSettings(updated);
    handleSaveGeneral(updated, true);
  };

  // Google Sheets Handlers
  const handleTestSheetConnection = async () => {
    if (!sheetConfig) return;
    setTestingSheet(true);
    setSheetTestMessage(null);
    try {
      const res = await fetch('/api/sheets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: sheetConfig.spreadsheet_id,
          sheetName: sheetConfig.sheet_name,
        }),
      });
      const data = await res.json();
      setSheetTestMessage({ success: data.success, text: data.message });
      if (data.success) success('Google Sheet connection verified!');
      else error(data.message || 'Connection failed');
    } catch (err: any) {
      setSheetTestMessage({ success: false, text: err?.message || 'Connection failed' });
      error('Failed to connect to Google Sheet');
    } finally {
      setTestingSheet(false);
    }
  };

  const handleSaveSheetConfig = async () => {
    if (!sheetConfig) return;
    setSaving(true);
    try {
      const res = await fetch('/api/sheets/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      success('Google Sheet configuration saved successfully!');
      loadAllSettings();
    } catch (err: any) {
      error(err?.message || 'Failed to save Google Sheet settings');
    } finally {
      setSaving(false);
    }
  };

  // Instagram Handlers
  const handleTestInstagramConnection = async () => {
    if (!instagramConfig) return;
    setTestingInstagram(true);
    setInstagramTestMessage(null);
    try {
      const res = await fetch('/api/instagram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: instagramConfig.account_id,
          accessToken: instagramConfig.access_token,
        }),
      });
      const data = await res.json();
      setInstagramTestMessage({ success: data.success, text: data.message });
      if (data.success) success('Instagram connection verified!');
      else error(data.message || 'Verification failed');
    } catch (err: any) {
      setInstagramTestMessage({ success: false, text: err?.message || 'Verification failed' });
      error('Failed to connect to Meta Graph API');
    } finally {
      setTestingInstagram(false);
    }
  };

  const handleTestAnalyticsConnection = async () => {
    setTestingAnalytics(true);
    setAnalyticsTestMessage(null);
    try {
      const res = await fetch('/api/growth/analytics/test');
      const data = await res.json();
      if (data.success) {
        setAnalyticsTestMessage({
          success: true,
          text: `Analytics Insights verified! Account @${data.account || '_hpsconfession_'} has active instagram_business_manage_insights permission.`,
        });
        success('Instagram Analytics Insights verified!');
      } else {
        const msg = data.error || 'Instagram analytics check failed';
        setAnalyticsTestMessage({ success: false, text: msg });
        error(msg);
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to verify analytics connection';
      setAnalyticsTestMessage({ success: false, text: msg });
      error(msg);
    } finally {
      setTestingAnalytics(false);
    }
  };

  const handleConnectInstagram = async () => {
    if (!instagramConfig) return;
    setSaving(true);
    try {
      const res = await fetch('/api/instagram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instagramConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Connection failed');
      success(data.message || 'Instagram account saved successfully');
      setInstagramConfig((prev: any) => ({ ...prev, access_token: '', has_token: true }));
      loadAllSettings();
    } catch (err: any) {
      error(err?.message || 'Failed to save Instagram credentials');
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { id: 'general', label: 'General & Brand', icon: SettingsIcon },
    { id: 'google-sheets', label: 'Google Sheets', icon: FileSpreadsheet },
    { id: 'instagram', label: 'Instagram API', icon: Instagram },
    { id: 'ai', label: 'Groq AI Config', icon: Sparkles },
    { id: 'moderation', label: 'Moderation & PII', icon: ShieldAlert },
    { id: 'publishing', label: 'Publishing Rules', icon: Send },
    { id: 'hashtags', label: 'Hashtag Presets', icon: Hash },
    { id: 'growth', label: 'Growth Intelligence', icon: TrendingUp },
  ];

  if (loading || !generalSettings || !sheetConfig || !instagramConfig) {
    return (
      <DashboardLayout title="Platform Configuration">
        <div className="p-24 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading configuration...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title="Platform Settings"
      subtitle="Configure external integrations, AI parameters, moderation sensitivity, and publishing limits"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Navigation Tabs (3 Cols) */}
        <div className="lg:col-span-3 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left ${
                  isActive
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-zinc-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Tab Content Panel (9 Cols) */}
        <div className="lg:col-span-9 bg-white p-8 rounded-2xl border border-zinc-200/80 shadow-sm">
          {/* 1. GENERAL TAB */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-zinc-900">General Branding & Timezone</h3>
                <p className="text-xs text-zinc-500">
                  Customization applied to generated 1080x1080 post headers and signatures.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Brand Name</label>
                  <input
                    type="text"
                    value={generalSettings.brand_name}
                    onChange={(e) => updateSettingField('brand_name', e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Instagram Handle</label>
                  <input
                    type="text"
                    value={generalSettings.instagram_handle}
                    onChange={(e) => updateSettingField('instagram_handle', e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Operating Timezone</label>
                  <select
                    value={generalSettings.timezone}
                    onChange={(e) => updateSettingField('timezone', e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                  >
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save General Settings
                </button>
              </div>
            </div>
          )}

          {/* 2. GOOGLE SHEETS TAB */}
          {activeTab === 'google-sheets' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Google Sheets Integration</h3>
                  <p className="text-xs text-zinc-500">
                    Connect the confession submission form spreadsheet with dynamic column mapping.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {sheetConfig.last_sync_status === 'SUCCESS' ? 'Connected' : 'Active'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Spreadsheet ID</label>
                  <input
                    type="text"
                    value={sheetConfig.spreadsheet_id}
                    onChange={(e) =>
                      setSheetConfig({ ...sheetConfig, spreadsheet_id: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 font-mono text-xs"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">Found in Google Sheet URL between /d/ and /edit</p>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Sheet Tab Name</label>
                  <input
                    type="text"
                    value={sheetConfig.sheet_name}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, sheet_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs"
                  />
                </div>
              </div>

              {/* Column Mapping Section */}
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200/70 space-y-4">
                <div className="font-bold text-xs text-zinc-900">Configurable Column Positions</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block text-zinc-500 font-medium mb-1">Timestamp</label>
                    <input
                      type="text"
                      value={sheetConfig.column_mapping.timestampColumn}
                      onChange={(e) =>
                        setSheetConfig({
                          ...sheetConfig,
                          column_mapping: { ...sheetConfig.column_mapping, timestampColumn: e.target.value },
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-center font-bold text-xs uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-500 font-medium mb-1">Name</label>
                    <input
                      type="text"
                      value={sheetConfig.column_mapping.nameColumn}
                      onChange={(e) =>
                        setSheetConfig({
                          ...sheetConfig,
                          column_mapping: { ...sheetConfig.column_mapping, nameColumn: e.target.value },
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-center font-bold text-xs uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-500 font-medium mb-1">Confession</label>
                    <input
                      type="text"
                      value={sheetConfig.column_mapping.confessionColumn}
                      onChange={(e) =>
                        setSheetConfig({
                          ...sheetConfig,
                          column_mapping: { ...sheetConfig.column_mapping, confessionColumn: e.target.value },
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-center font-bold text-xs uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-500 font-medium mb-1">Status</label>
                    <input
                      type="text"
                      value={sheetConfig.column_mapping.statusColumn}
                      onChange={(e) =>
                        setSheetConfig({
                          ...sheetConfig,
                          column_mapping: { ...sheetConfig.column_mapping, statusColumn: e.target.value },
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 text-center font-bold text-xs uppercase"
                    />
                  </div>
                </div>
              </div>

              {sheetTestMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    sheetTestMessage.success
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{sheetTestMessage.text}</span>
                </div>
              )}

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
                <button
                  onClick={handleTestSheetConnection}
                  disabled={testingSheet}
                  className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  {testingSheet ? 'Testing Connection...' : 'Test Connection'}
                </button>

                <button
                  onClick={handleSaveSheetConfig}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Sheet Mapping'}
                </button>
              </div>
            </div>
          )}

          {/* 3. INSTAGRAM TAB */}
          {activeTab === 'instagram' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Instagram Graph API</h3>
                  <p className="text-xs text-zinc-500">
                    Official Meta API for Instagram Professional accounts.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-500">Status:</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    instagramConfig.is_connected
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                  }`}>
                    {instagramConfig.is_connected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
              </div>

              {instagramConfig?.is_connected && !instagramConfig?.configured_via_env && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Important: Persist Credentials on Render</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Credentials are currently saved in temporary server memory. If Render sleeps or redeploys, memory resets and publishing will pause with <em>&quot;Instagram credentials are not configured&quot;</em>.
                    To make them 100% permanent across all restarts and redeploys, add these two environment variables in your <strong>Render Dashboard → Environment</strong>:
                  </p>
                  <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/80 font-mono text-[11px] text-zinc-800 space-y-1 select-all">
                    <div><strong>INSTAGRAM_ACCOUNT_ID</strong> = {instagramConfig.account_id || '17841437796028856'}</div>
                    <div><strong>INSTAGRAM_ACCESS_TOKEN</strong> = (paste your long-lived token)</div>
                  </div>
                </div>
              )}

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">
                    Instagram Account ID
                  </label>
                  <input
                    type="text"
                    value={instagramConfig.account_id || ''}
                    placeholder="178414..."
                    onChange={(e) =>
                      setInstagramConfig({ ...instagramConfig, account_id: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 font-mono text-xs"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Meta Business / Instagram User ID for your connected Professional Instagram account
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">
                    Instagram Access Token
                  </label>
                  <input
                    type="password"
                    placeholder={instagramConfig.has_token ? '••••••••••••••••••••••••••••••••' : 'Paste your Instagram Access Token'}
                    value={instagramConfig.access_token || ''}
                    onChange={(e) =>
                      setInstagramConfig({ ...instagramConfig, access_token: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 font-mono text-xs"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Instagram User access token generated through Instagram Login.
                  </p>
                </div>

                {/* Scopes Guidance Box */}
                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200/80 space-y-2 text-xs">
                  <div className="font-semibold text-zinc-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-brand-600" />
                    <span>Required Instagram Login Scopes</span>
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    For automated posting and Growth Intelligence Insights, the token must be granted these permissions via Instagram Login:
                  </p>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    <span className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700">instagram_business_basic</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700">instagram_business_content_publish</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">instagram_business_manage_insights</span>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Note: Do not use Facebook Login scopes (<code>instagram_basic</code>). Use official Instagram Login scopes.
                  </p>
                </div>
              </div>

              {instagramTestMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    instagramTestMessage.success
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{instagramTestMessage.text}</span>
                </div>
              )}

              {analyticsTestMessage && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                    analyticsTestMessage.success
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span>{analyticsTestMessage.text}</span>
                </div>
              )}

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestInstagramConnection}
                    disabled={testingInstagram}
                    className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                  >
                    {testingInstagram ? 'Testing API...' : 'Test Connection'}
                  </button>

                  <button
                    onClick={handleTestAnalyticsConnection}
                    disabled={testingAnalytics}
                    className="px-4 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    {testingAnalytics ? 'Testing Insights...' : 'Test Analytics Insights'}
                  </button>
                </div>

                <button
                  onClick={handleConnectInstagram}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-rose-500 hover:from-brand-700 hover:to-rose-600 text-white text-xs font-semibold shadow-md shadow-brand-500/20 cursor-pointer"
                >
                  Save Instagram Credentials
                </button>
              </div>
            </div>
          )}

          {/* 4. AI CONFIG TAB */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Groq AI Processing Configuration</h3>
                <p className="text-xs text-zinc-500">
                  Ultra-fast Llama 3.3 inference for grammar polishing, hook captions, and hashtag generation.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">AI Provider</label>
                  <input
                    type="text"
                    disabled
                    value="Groq AI (Ultra-fast LPUs)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Model Identifier</label>
                  <select
                    defaultValue="llama-3.3-70b-versatile"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                  >
                    <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Recommended)</option>
                    <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Fastest)</option>
                    <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Temperature (Fidelity)</label>
                  <input
                    type="number"
                    step="0.1"
                    defaultValue={0.2}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Kept low (0.2) to prevent AI hallucinations or altering user story facts.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Structured Output Mode</label>
                  <input
                    type="text"
                    disabled
                    value="json_object (Guaranteed schema)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 text-xs"
                  />
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200/70 text-xs text-amber-900 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Groq API Key Configured Server-Side:</strong> When <code>GROQ_API_KEY</code> is set in <code>.env.local</code>, requests will stream through high-speed hardware LPUs. If omitted, the deterministic safety engine handles processing.
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => success('Groq AI settings confirmed!')}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save AI Settings
                </button>
              </div>
            </div>
          )}

          {/* 5. MODERATION & PII TAB */}
          {activeTab === 'moderation' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Content Moderation & Privacy Guard</h3>
                <p className="text-xs text-zinc-500">
                  Automated regex filters and privacy guardrails to protect user identities.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <div>
                    <div className="font-bold text-zinc-900">Strict PII Masking & Detection</div>
                    <p className="text-zinc-500">
                      Detects phone numbers, email addresses, social media handles, and ID numbers.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={generalSettings.enable_pii_detection}
                    onChange={(e) => updateSettingField('enable_pii_detection', e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300 text-brand-600"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  <div>
                    <div className="font-bold text-zinc-900">Profanity & Abusive Language Filter</div>
                    <p className="text-zinc-500">
                      Flags harassment, doxxing, and hate speech with MEDIUM or HIGH risk warnings.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={generalSettings.enable_profanity_filter}
                    onChange={(e) => updateSettingField('enable_profanity_filter', e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300 text-brand-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">
                    Automated Risk Threshold
                  </label>
                  <select
                    value={generalSettings.risk_threshold}
                    onChange={(e) => updateSettingField('risk_threshold', e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                  >
                    <option value="LOW">Low (Flag anything above Low)</option>
                    <option value="MEDIUM">Medium (Allow Low & Medium, block High)</option>
                    <option value="HIGH">Permissive (Require review only on critical High risk)</option>
                  </select>
                </div>

                {/* Confession Quality Gate Section */}
                <div className="pt-5 border-t border-zinc-200/80 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <span>Confession Quality Gate & Low-Value Content Filtering</span>
                    </h4>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Prevents gibberish, emoji-only, meaningless one-word noise, and test submissions from ever entering the publish queue while preserving meaningful short confessions.
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                    <div>
                      <span className="font-semibold text-zinc-800 block">Enable Content Quality Gate</span>
                      <p className="text-[11px] text-zinc-500">
                        Evaluates all incoming submissions through deterministic and semantic quality checks.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={generalSettings.enable_quality_gate !== false}
                      onChange={(e) => updateSettingField('enable_quality_gate', e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300 text-purple-600"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                    <div>
                      <span className="font-semibold text-zinc-800 block">Auto-Reject Low-Value Noise</span>
                      <p className="text-[11px] text-zinc-500">
                        Automatically routes low-value content to the Rejected section without human intervention.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={generalSettings.auto_reject_low_value !== false}
                      onChange={(e) => updateSettingField('auto_reject_low_value', e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300 text-purple-600"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                    <div>
                      <span className="font-semibold text-zinc-800 block">Groq Semantic Quality Analysis</span>
                      <p className="text-[11px] text-zinc-500">
                        Uses Llama 3.3 70B to evaluate emotional and confession substance beyond word count.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={generalSettings.enable_groq_quality !== false}
                      onChange={(e) => updateSettingField('enable_groq_quality', e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300 text-purple-600"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1.5">
                      Minimum Quality Score Threshold (0 - 100)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={generalSettings.min_quality_score ?? 55}
                      onChange={(e) => updateSettingField('min_quality_score', parseInt(e.target.value, 10) || 55)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Scores below 55 are rejected as Low Value. Scores between 55 and 79 require review. Scores 80+ are approved.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save Moderation Rules
                </button>
              </div>
            </div>
          )}

          {/* 6. PUBLISHING RULES TAB */}
          {activeTab === 'publishing' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-zinc-900">24/7 Autonomous Publishing</h3>
                <p className="text-xs text-zinc-500">
                  Configure hands-free automated posting to Instagram so you never have to open the app manually.
                </p>
              </div>

              {/* Master Auto-Publish Toggle Card */}
              <div className="p-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/60 to-pink-50/30 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-zinc-900">Hands-Free 24/7 Auto-Publish</span>
                    {generalSettings.auto_publish !== false && generalSettings.publishing_mode !== 'MANUAL_APPROVAL' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-600 text-white flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> ACTIVE (ALWAYS ON)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-200 text-zinc-600">
                        PAUSED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 max-w-xl">
                    When active, the server continuously pulls new submissions from your Google Sheet, moderates safety, formats the caption & hashtags with AI, renders the 1080x1350 (4:5) portrait card image, and broadcasts safe confessions directly to Instagram on schedule without needing to log in.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={generalSettings.auto_publish !== false && generalSettings.publishing_mode !== 'MANUAL_APPROVAL'}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      const updated = {
                        ...generalSettings,
                        auto_publish: enabled,
                        auto_publish_enabled: enabled,
                        publishing_mode: enabled ? ('AUTO_PUBLISH' as const) : ('MANUAL_APPROVAL' as const),
                      };
                      setGeneralSettings(updated);
                      handleSaveGeneral(updated, true);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Publishing Mode</label>
                  <select
                    value={generalSettings.publishing_mode || 'AUTO_PUBLISH'}
                    onChange={(e) => {
                      const mode = e.target.value as any;
                      const isAuto = mode === 'AUTO_PUBLISH';
                      const updated = {
                        ...generalSettings,
                        publishing_mode: mode,
                        auto_publish: isAuto,
                        auto_publish_enabled: isAuto,
                      };
                      setGeneralSettings(updated);
                      handleSaveGeneral(updated, true);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                  >
                    <option value="AUTO_PUBLISH">Full Auto-Publish (24/7 Hands-Free - Recommended)</option>
                    <option value="AUTO_APPROVAL">Auto-Approve Safe Confessions (Wait for manual broadcast)</option>
                    <option value="MANUAL_APPROVAL">Manual Admin Approval Only</option>
                  </select>
                </div>

                {/* SECTION 1: HARD OPERATIONAL LIMITS / GUARDRAILS */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-3 border-b border-zinc-100 pb-2">
                    <div>
                      <h4 className="font-bold text-xs text-zinc-900 uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-zinc-600" />
                        Posting Limits (Hard Operational Guardrails)
                      </h4>
                      <p className="text-[11px] text-zinc-500">
                        Operational boundaries defining what the system is allowed to do. Growth Intelligence optimizes within these hard limits.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {/* Minimum Daily Posts */}
                    <div>
                      <label className="block font-semibold text-zinc-700 mb-1.5">
                        Minimum Daily Posts (Hard Floor)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={generalSettings.min_daily_posts ?? 2}
                        onChange={(e) => updateSettingField('min_daily_posts', Math.max(1, parseInt(e.target.value || '2', 10)))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Safety floor: System will never schedule fewer than this even during extreme lulls.
                      </span>
                    </div>

                    {/* Fallback Target Daily Posts */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block font-semibold text-zinc-700">
                          Fallback Target Daily Posts
                        </label>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200">
                          Fallback Only
                        </span>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={generalSettings.target_daily_posts ?? 4}
                        onChange={(e) => updateSettingField('target_daily_posts', Math.max(1, parseInt(e.target.value || '4', 10)))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Used <strong>strictly as fallback</strong> when Growth Intelligence has insufficient data (N&lt;20 posts or &lt;7 days). Not a mandatory quota.
                      </span>
                    </div>

                    {/* Maximum Daily Posts */}
                    <div>
                      <label className="block font-semibold text-zinc-700 mb-1.5">
                        Maximum Daily Posts (Hard Ceiling)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={generalSettings.max_daily_posts ?? 12}
                        onChange={(e) => updateSettingField('max_daily_posts', parseInt(e.target.value || '12', 10))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Hard upper limit: Growth Intelligence can <strong>never</strong> override or exceed this ceiling.
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    {/* Safe Human Daytime Window */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block font-semibold text-zinc-700">
                          Active Hours Window (Account Timezone)
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = {
                              ...generalSettings,
                              auto_publish_start_hour: 0,
                              auto_publish_end_hour: 24,
                            };
                            setGeneralSettings(updated);
                            handleSaveGeneral(updated, true);
                          }}
                          className="text-[10px] text-purple-600 font-bold hover:underline cursor-pointer"
                        >
                          ⚡ Set 24/7 All Day & Night
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={generalSettings.auto_publish_start_hour ?? 9}
                          onChange={(e) => updateSettingField('auto_publish_start_hour', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          {Array.from({ length: 24 }).map((_, h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, '0')}:00 {h === 0 ? '(Midnight)' : h === 9 ? '(9 AM - Start)' : ''}
                            </option>
                          ))}
                        </select>
                        <span className="text-zinc-500">to</span>
                        <select
                          value={generalSettings.auto_publish_end_hour ?? 22}
                          onChange={(e) => updateSettingField('auto_publish_end_hour', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          {Array.from({ length: 25 }).map((_, h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, '0')}:00 {h === 24 ? '(24:00 - 24/7)' : h === 22 ? '(10 PM - Rest)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        {(generalSettings.auto_publish_start_hour ?? 0) === 0 && (generalSettings.auto_publish_end_hour ?? 24) >= 24
                          ? '🟢 24/7 Continuous Publishing Active (Posts round the clock without nightly pause).'
                          : 'Overnight rest active. Posts hold until next morning to protect Meta trust score.'}
                      </span>
                    </div>

                    {/* Gap Guardrails */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block font-semibold text-zinc-700">
                          Post Spacing Guardrails (Min/Max Gap)
                        </label>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                          {generalSettings.current_random_gap_minutes ?? 60}m active
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={generalSettings.min_gap_minutes ?? 30}
                          onChange={(e) => updateSettingField('min_gap_minutes', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          <option value={20}>20m min</option>
                          <option value={25}>25m min</option>
                          <option value={30}>30m min (Default)</option>
                          <option value={45}>45m min</option>
                          <option value={60}>60m min</option>
                        </select>
                        <span className="text-zinc-500 text-xs">to</span>
                        <select
                          value={generalSettings.max_gap_minutes ?? 75}
                          onChange={(e) => updateSettingField('max_gap_minutes', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          <option value={60}>60m max</option>
                          <option value={75}>75m max (Default)</option>
                          <option value={90}>90m max (1.5h)</option>
                          <option value={120}>120m max (2h)</option>
                          <option value={180}>180m max (3h)</option>
                        </select>
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Hard min/max bounds: Posts will not publish faster than {generalSettings.min_gap_minutes ?? 30}m or wait longer than {generalSettings.max_gap_minutes ?? 75}m.
                      </span>
                    </div>
                  </div>
                </div>

                {/* SECTION 2: GROWTH INTELLIGENCE STRATEGY & ACTIVE AUTHORITY */}
                <div className="p-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/60 via-indigo-50/40 to-white text-zinc-900 space-y-3 mt-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <div>
                        <span className="font-bold text-xs text-purple-950">Growth Intelligence Strategy & Authority</span>
                        <span className="text-[10px] text-purple-700/80 block">
                          Performance strategy derived from empirical frequency saturation & reach curves
                        </span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border ${
                      dailyPlan?.authority_source === 'GROWTH_INTELLIGENCE'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : dailyPlan?.authority_source === 'SETTINGS_HARD_LIMIT'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : dailyPlan?.authority_source === 'ADMIN_OVERRIDE'
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                      {dailyPlan?.authority_source ? dailyPlan.authority_source.replace(/_/g, ' ') : 'SETTINGS FALLBACK'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    {/* Planned Daily Frequency */}
                    <div className="p-3 bg-white/95 rounded-lg border border-purple-100 shadow-xs">
                      <span className="text-[10px] text-zinc-500 font-medium block">Planned Frequency</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg font-bold text-purple-950">
                          {dailyPlan?.effective_daily_posts ?? generalSettings.target_daily_posts ?? 4}
                        </span>
                        <span className="text-xs text-zinc-500 font-medium">posts/day</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        {dailyPlan?.is_fallback
                          ? `Fallback target active (${generalSettings.min_daily_posts ?? 2}–${generalSettings.max_daily_posts ?? 12} limits)`
                          : `Recommended: ${dailyPlan?.recommended_posts ?? 4}/day (Overrides target)`}
                      </span>
                    </div>

                    {/* Evidence & Confidence */}
                    <div className="p-3 bg-white/95 rounded-lg border border-purple-100 shadow-xs">
                      <span className="text-[10px] text-zinc-500 font-medium block">Empirical Confidence</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg font-bold text-purple-950">
                          {Math.round((dailyPlan?.confidence ?? 0) * 100)}%
                        </span>
                        <span className="text-xs text-zinc-500 font-medium">statistical</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        N={dailyPlan?.sample_size ?? cadenceRec?.evidenceCount ?? 0} posts across {dailyPlan?.days_of_data ?? 0} days
                      </span>
                    </div>

                    {/* Cadence Spacing & Jitter */}
                    <div className="p-3 bg-white/95 rounded-lg border border-purple-100 shadow-xs">
                      <span className="text-[10px] text-zinc-500 font-medium block">Recommended Spacing</span>
                      <span className="font-semibold text-zinc-900 text-xs mt-1 block">
                        {dailyPlan?.recommended_spacing
                          ? `${dailyPlan.recommended_spacing.min_minutes}m – ${dailyPlan.recommended_spacing.max_minutes}m`
                          : `${cadenceRec?.recommendedGapRangeMinutes?.min ?? 30}m – ${cadenceRec?.recommendedGapRangeMinutes?.max ?? 75}m`}
                      </span>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Rolling Horizon: {generalSettings.rolling_horizon_hours ?? 24} hours
                      </span>
                    </div>

                    {/* Strategy Mode Switcher */}
                    <div className="p-3 bg-white/95 rounded-lg border border-purple-100 shadow-xs">
                      <span className="text-[10px] text-zinc-500 font-medium block">Strategy Authority Mode</span>
                      <select
                        value={generalSettings.scheduling_strategy_mode || 'AUTO'}
                        onChange={(e) => handleUpdateCadenceOverride(e.target.value as any, generalSettings.manual_fixed_gap_minutes)}
                        className="w-full mt-1.5 px-2 py-1.5 rounded-md border border-zinc-200 text-xs font-medium bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      >
                        <option value="AUTO">AUTO (Growth Adaptive)</option>
                        <option value="BASELINE">BASELINE (Exploration)</option>
                        <option value="MANUAL">MANUAL (Admin Override)</option>
                      </select>
                      <span className="text-[9px] text-zinc-400 mt-1 block">
                        AUTO allows Growth Intelligence to decide.
                      </span>
                    </div>
                  </div>

                  {/* Saturation Warning if Degradation Detected */}
                  {dailyPlan?.saturation_detected && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold block">Reach Degradation Warning Observed:</span>
                        <span>
                          Account analytics detected that posting more than {dailyPlan.saturation_knee_posts_per_day} posts/day diminishes average reach per post. The scheduler is intentionally pacing posts to maximize per-post reach.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Observational Reasoning */}
                  {(dailyPlan?.reason || cadenceRec?.reason) && (
                    <div className="text-[11px] text-purple-950 bg-purple-100/60 p-2.5 rounded-lg border border-purple-200/60 leading-relaxed">
                      <span className="font-semibold text-purple-900 block mb-0.5">Strategy Reasoning:</span>
                      {dailyPlan?.reason || cadenceRec?.reason}
                    </div>
                  )}
                </div>

                {/* Meta Account Safety & Trust Score Guide */}
                <div className="p-4 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-950 space-y-2 mt-4">
                  <div className="flex items-center gap-2 font-bold text-xs text-amber-900">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>Meta Anti-Ban & Human Behavior Protection Active</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] pt-1 text-amber-900/90 leading-relaxed">
                    <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60 shadow-xs">
                      <p className="font-semibold text-zinc-900 mb-0.5">☀️ Daytime Schedule</p>
                      <p className="text-zinc-600">Active 9:00 AM to 10:00 PM only. Shuts down overnight to mimic natural human sleep cycles.</p>
                    </div>
                    <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60 shadow-xs">
                      <p className="font-semibold text-zinc-900 mb-0.5">🎲 Adaptive Cadence</p>
                      <p className="text-zinc-600">
                        {generalSettings.random_gap_enabled !== false ? (
                          <>
                            <strong className="text-emerald-700 font-semibold">{generalSettings.current_random_gap_minutes ?? 45}m gap</strong> active for upcoming post. Gaps adapt based on {cadenceRec?.strategy ? cadenceRec.strategy.replace(/_/g, ' ') : 'Growth Intelligence'}.
                          </>
                        ) : (
                          <>
                            <strong className="text-emerald-700 font-semibold">+{generalSettings.current_jitter_minutes ?? 14}m jitter</strong> applied to fixed cooldown.
                          </>
                        )}
                      </p>
                    </div>
                    <div className="bg-white/80 p-2.5 rounded-lg border border-amber-200/60 shadow-xs">
                      <p className="font-semibold text-zinc-900 mb-0.5">📱 Mobile App Activity</p>
                      <p className="text-zinc-600">Open <strong className="font-semibold">@_hpsconfession_</strong> on your phone for 30s daily (like a post/story) to register real device sessions.</p>
                    </div>
                  </div>
                </div>

                {/* Instant Trigger Test Button */}
                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-between gap-4 mt-4">
                  <div>
                    <h4 className="font-semibold text-zinc-900 text-xs">Manual Test Trigger</h4>
                    <p className="text-[11px] text-zinc-500">
                      Immediately trigger an automated publishing cycle right now to test post generation and publishing.
                    </p>
                  </div>
                  <button
                    onClick={() => handleTriggerAutoPublish(true)}
                    disabled={runningAutoPublish}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-60 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${runningAutoPublish ? 'animate-spin' : ''}`} />
                    <span>{runningAutoPublish ? 'Running...' : 'Run Auto-Publish Now'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Publishing Rules'}
                </button>
              </div>
            </div>
          )}

          {/* 7. HASHTAGS TAB */}
          {activeTab === 'hashtags' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Default Hashtag Presets</h3>
                <p className="text-xs text-zinc-500">
                  Global hashtags automatically appended to generated Instagram post captions.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-2">Active Presets</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(generalSettings.default_hashtags || []).map((tag, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-800 font-semibold text-xs border border-zinc-200 flex items-center gap-1.5"
                      >
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">
                    Edit Hashtag List (Space-separated)
                  </label>
                  <input
                    type="text"
                    value={(generalSettings.default_hashtags || []).join(' ')}
                    onChange={(e) => {
                      const tags = e.target.value
                        .split(' ')
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .map((t) => (t.startsWith('#') ? t : `#${t}`));
                      setGeneralSettings({ ...generalSettings, default_hashtags: tags });
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save Hashtags
                </button>
              </div>
            </div>
          )}

          {/* 8. GROWTH INTELLIGENCE TAB */}
          {activeTab === 'growth' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Growth Intelligence & Controlled Trials</h3>
                  <p className="text-xs text-zinc-500">
                    Telemetry collection, 9:16 Reel video synthesis, smart recommendation models, and A/B experiments.
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    generalSettings.enable_growth_intelligence
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                  }`}
                >
                  {generalSettings.enable_growth_intelligence ? 'Subsystem Enabled' : 'Subsystem Disabled'}
                </span>
              </div>

              {/* Master Subsystem Switch */}
              <div className="p-4 bg-gradient-to-r from-indigo-50/70 to-purple-50/70 rounded-2xl border border-indigo-100 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="font-bold text-xs text-indigo-950 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                    <span>Master Growth Intelligence System</span>
                  </div>
                  <p className="text-[11px] text-indigo-800/80">
                    When disabled, all analytics observation tasks, reel synthesis, and recommendation services remain inert.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(generalSettings.enable_growth_intelligence)}
                    onChange={(e) => updateSettingField('enable_growth_intelligence', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {/* Modular Engine Feature Flags */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-wider text-[11px]">
                  Modular Subsystem Flags
                </h4>

                {/* 1. Analytics Collection */}
                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Background Performance Collector</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Polls Meta Graph API v21.0 metrics across 10 lifecycle snapshots (15m, 30m, 1h, 3h, 6h, 12h, 24h, 48h, 72h, 7d).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(generalSettings.enable_analytics_collection)}
                      onChange={(e) => updateSettingField('enable_analytics_collection', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {/* 2. Reel Engine */}
                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Dynamic 9:16 Reel Video Generator</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Renders 1080x1920 MP4/WebM vertical video assets with hook animations (0–1.5s hook, 1.5–7s body, 7–10s CTA).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(generalSettings.enable_reel_engine)}
                      onChange={(e) => updateSettingField('enable_reel_engine', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {/* 3. Smart Recommendations */}
                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Smart Pre-Publishing Content Preparation</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Analyzes historical reach distributions to suggest optimal format (Image vs Reel), timing window, and hook styles.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(generalSettings.enable_growth_recommendations)}
                      onChange={(e) => updateSettingField('enable_growth_recommendations', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {/* 4. Automated Timing Optimization */}
                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Automated Publishing Window Optimization</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Aligns automated publishing queues with empirical peak engagement hours.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(generalSettings.enable_auto_optimization)}
                      onChange={(e) => updateSettingField('enable_auto_optimization', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {/* 5. Experiments */}
                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Controlled A/B Experimentation Engine</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Enables single-variable controlled trials with statistical support gates (N &lt; 5 Insufficient, N 5–9 Preliminary, N 10–19 Promising, N &ge; 20 Supported).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(generalSettings.enable_experiments)}
                      onChange={(e) => updateSettingField('enable_experiments', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>

              {/* Safety Guarantees & Non-Causal Boundary Notice */}
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200/80 space-y-2 text-xs text-zinc-600">
                <div className="font-bold text-zinc-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Production Safety &amp; Non-Causal Epistemology Guarantees</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-zinc-500">
                  <li><strong>Non-Blocking Publishing:</strong> Instagram publishing will always succeed even if analytics collection encounters network failure.</li>
                  <li><strong>Null vs Zero Metric Integrity:</strong> Unavailable metrics are stored as null (never fabricated as 0).</li>
                  <li><strong>Correlation vs Causation:</strong> Growth models never claim causality; all insights declare sample size (N) and confounders.</li>
                </ul>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/growth/posts', { method: 'POST' });
                      const d = await res.json();
                      if (d.success) success('Instant analytics collection cycle executed!');
                      else error(d.error || 'Collection cycle failed');
                    } catch {
                      error('Failed to trigger collection');
                    }
                  }}
                  className="px-4 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 cursor-pointer"
                >
                  Trigger Snapshot Collection Now
                </button>

                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save Growth Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout title="Platform Settings">
          <div className="p-24 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading settings...</span>
          </div>
        </DashboardLayout>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

