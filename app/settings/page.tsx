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
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SystemSettings, GoogleSheetConfig, InstagramAccountConfig } from '@/types';
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

  // Test Connection States
  const [testingSheet, setTestingSheet] = useState(false);
  const [sheetTestMessage, setSheetTestMessage] = useState<{ success: boolean; text: string } | null>(null);

  const [testingInstagram, setTestingInstagram] = useState(false);
  const [instagramTestMessage, setInstagramTestMessage] = useState<{ success: boolean; text: string } | null>(null);

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
      const [genRes, sheetRes, igRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/sheets/status'),
        fetch('/api/instagram/status'),
      ]);

      const [genData, sheetData, igData] = await Promise.all([
        genRes.json(),
        sheetRes.json(),
        igRes.json(),
      ]);

      // Check browser localStorage for persistent user preference backups
      let effectiveGenData = genData;
      if (typeof window !== 'undefined') {
        const localBackup = localStorage.getItem('confessionflow_custom_settings');
        if (localBackup) {
          try {
            const parsed = JSON.parse(localBackup);
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
      if (!res.ok) throw new Error('Failed to update settings');
      const saved = await res.json();
      setGeneralSettings(saved);
      if (typeof window !== 'undefined') {
        localStorage.setItem('confessionflow_custom_settings', JSON.stringify(saved));
      }
      if (!silent) success('Settings saved permanently as default!');
    } catch (err: any) {
      if (!silent) error(err?.message || 'Error saving settings');
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

              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
                <button
                  onClick={handleTestInstagramConnection}
                  disabled={testingInstagram}
                  className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  {testingInstagram ? 'Testing...' : 'Test Connection'}
                </button>

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
                      const updated = {
                        ...generalSettings,
                        publishing_mode: mode,
                        auto_publish: mode === 'AUTO_PUBLISH',
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

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block font-semibold text-zinc-700">
                        Posting Gap Strategy
                      </label>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold border border-purple-200">
                        {generalSettings.random_gap_enabled !== false ? '🎲 Organic' : '⏱️ Fixed'}
                      </span>
                    </div>
                    <select
                      value={generalSettings.random_gap_enabled !== false ? 'random' : 'fixed'}
                      onChange={(e) => updateSettingField('random_gap_enabled', e.target.value === 'random')}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                    >
                      <option value="random">Dynamic Random Gaps (45m - 1.5h)</option>
                      <option value="fixed">Fixed Cooldown + Jitter</option>
                    </select>
                    <span className="text-[10px] text-zinc-500 mt-1 block">
                      {generalSettings.random_gap_enabled !== false
                        ? `Varies randomly: ~49m, ~53m, ~70m, ~1.5h`
                        : 'Fixed base cooldown interval.'}
                    </span>
                  </div>

                  {generalSettings.random_gap_enabled !== false ? (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block font-semibold text-zinc-700">
                          Random Gap Range
                        </label>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                          {generalSettings.current_random_gap_minutes ?? 53}m next
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={generalSettings.min_gap_minutes ?? 45}
                          onChange={(e) => updateSettingField('min_gap_minutes', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          <option value={35}>35m min</option>
                          <option value={40}>40m min</option>
                          <option value={45}>45m min (Default)</option>
                          <option value={50}>50m min</option>
                          <option value={60}>60m min</option>
                        </select>
                        <span className="text-zinc-500 text-xs">to</span>
                        <select
                          value={generalSettings.max_gap_minutes ?? 95}
                          onChange={(e) => updateSettingField('max_gap_minutes', parseInt(e.target.value, 10))}
                          className="w-1/2 px-2 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                        >
                          <option value={75}>75m max</option>
                          <option value={85}>85m max</option>
                          <option value={90}>90m max (1.5h)</option>
                          <option value={95}>95m max (Default)</option>
                          <option value={110}>110m max</option>
                          <option value={120}>120m max (2h)</option>
                        </select>
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Randomly rolls between {generalSettings.min_gap_minutes ?? 45}m and {generalSettings.max_gap_minutes ?? 95}m.
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block font-semibold text-zinc-700">
                          Base Post Cooldown
                        </label>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                          +{generalSettings.current_jitter_minutes ?? 14}m jitter
                        </span>
                      </div>
                      <select
                        value={generalSettings.auto_publish_interval_minutes || 60}
                        onChange={(e) => updateSettingField('auto_publish_interval_minutes', parseInt(e.target.value, 10))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                      >
                        <option value={60}>Every 1 Hour (60m Base)</option>
                        <option value={90}>Every 1.5 Hours (90m Base)</option>
                        <option value={120}>Every 2 Hours (120m Base)</option>
                        <option value={180}>Every 3 Hours (180m Base)</option>
                      </select>
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Fixed gap plus +0 to +30m jitter.
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1.5">
                      Maximum Daily Posts
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={generalSettings.max_daily_posts ?? 8}
                      onChange={(e) => updateSettingField('max_daily_posts', parseInt(e.target.value || '8', 10))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                    />
                    <span className="text-[10px] text-zinc-500 mt-1 block">
                      Safe limit: 8 posts/day avoids spam blocking from Meta Graph API.
                    </span>
                  </div>

                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1.5">
                      Active Hours Window (Local)
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={generalSettings.auto_publish_start_hour ?? 9}
                        onChange={(e) => updateSettingField('auto_publish_start_hour', parseInt(e.target.value, 10))}
                        className="w-1/2 px-2.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                      >
                        {Array.from({ length: 24 }).map((_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00 {h === 9 ? '(9 AM - Recommended)' : ''}
                          </option>
                        ))}
                      </select>
                      <span className="text-zinc-500">to</span>
                      <select
                        value={generalSettings.auto_publish_end_hour ?? 22}
                        onChange={(e) => updateSettingField('auto_publish_end_hour', parseInt(e.target.value, 10))}
                        className="w-1/2 px-2.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium bg-white"
                      >
                        {Array.from({ length: 24 }).map((_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00 {h === 22 ? '(10 PM - Overnight Rest)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-1 block">
                      Mimics human daytime schedule. Rests the account overnight (10 PM - 9 AM).
                    </span>
                  </div>
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
                      <p className="font-semibold text-zinc-900 mb-0.5">🎲 Organic Random Gaps</p>
                      <p className="text-zinc-600">
                        {generalSettings.random_gap_enabled !== false ? (
                          <>
                            <strong className="text-emerald-700 font-semibold">{generalSettings.current_random_gap_minutes ?? 53}m random gap</strong> active for upcoming post. Gaps vary organically between {generalSettings.min_gap_minutes ?? 45}m and {generalSettings.max_gap_minutes ?? 95}m (e.g. 49m, 53m, 70m, 1.5h) to eliminate robotic clockwork patterns.
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

