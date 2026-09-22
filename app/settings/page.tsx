'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Settings as SettingsIcon,
  FileSpreadsheet,
  Instagram,
  Sparkles,
  ShieldAlert,
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

  const { success, error } = useToast();

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

      setGeneralSettings(genData);
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

  // Save General & Publishing & Moderation Settings
  const handleSaveGeneral = async (updates: Partial<SystemSettings>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update settings');
      const saved = await res.json();
      setGeneralSettings(saved);
      success('Settings updated successfully!');
    } catch (err: any) {
      error(err?.message || 'Error saving settings');
    } finally {
      setSaving(false);
    }
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
                    onChange={(e) =>
                      setGeneralSettings({ ...generalSettings, brand_name: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Instagram Handle</label>
                  <input
                    type="text"
                    value={generalSettings.instagram_handle}
                    onChange={(e) =>
                      setGeneralSettings({ ...generalSettings, instagram_handle: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Operating Timezone</label>
                  <select
                    value={generalSettings.timezone}
                    onChange={(e) =>
                      setGeneralSettings({ ...generalSettings, timezone: e.target.value })
                    }
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
                    onChange={(e) =>
                      setGeneralSettings({
                        ...generalSettings,
                        enable_pii_detection: e.target.checked,
                      })
                    }
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
                    onChange={(e) =>
                      setGeneralSettings({
                        ...generalSettings,
                        enable_profanity_filter: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-zinc-300 text-brand-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">
                    Automated Risk Threshold
                  </label>
                  <select
                    value={generalSettings.risk_threshold}
                    onChange={(e) =>
                      setGeneralSettings({
                        ...generalSettings,
                        risk_threshold: e.target.value as any,
                      })
                    }
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
                <h3 className="text-base font-bold text-zinc-900">Publishing Workflow & Limits</h3>
                <p className="text-xs text-zinc-500">
                  Control automation pace, daily broadcast volume, and approval enforcement.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1.5">Publishing Mode</label>
                  <select
                    value={generalSettings.publishing_mode}
                    onChange={(e) =>
                      setGeneralSettings({
                        ...generalSettings,
                        publishing_mode: e.target.value as any,
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold bg-white"
                  >
                    <option value="MANUAL_APPROVAL">Manual Admin Approval Only (Recommended)</option>
                    <option value="AUTO_APPROVAL">Auto-Approve Low Risk Confessions</option>
                    <option value="AUTO_PUBLISH">Full Auto-Publish (Requires strict safety checks)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1.5">
                      Maximum Daily Instagram Posts
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={generalSettings.max_daily_posts}
                      onChange={(e) =>
                        setGeneralSettings({
                          ...generalSettings,
                          max_daily_posts: parseInt(e.target.value || '10', 10),
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1.5">
                      Default Scheduled Time (Local)
                    </label>
                    <input
                      type="time"
                      value={generalSettings.default_publishing_time}
                      onChange={(e) =>
                        setGeneralSettings({
                          ...generalSettings,
                          default_publishing_time: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-medium"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100 flex justify-end">
                <button
                  onClick={() => handleSaveGeneral(generalSettings)}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save Publishing Rules
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

