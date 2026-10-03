'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  Eye,
  Check,
  X,
  Instagram,
  Calendar,
  Sparkles,
  RefreshCw,
  Trash2,
  Clock,
  CheckCircle2,
  ListTodo,
  RotateCcw,
  AlertTriangle,
  Wrench,
  Zap,
  Undo2,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PublishModal } from '@/components/confessions/PublishModal';
import { ScheduleModal } from '@/components/confessions/ScheduleModal';
import { useToast } from '@/components/ui/ToastContext';

type TabType = 'queue' | 'scheduled' | 'published' | 'deleted';

export default function ConfessionsPage() {
  const [allConfessions, setAllConfessions] = useState<Confession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('queue');

  // Filters
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Modals
  const [selectedForPublish, setSelectedForPublish] = useState<Confession | null>(null);
  const [selectedForSchedule, setSelectedForSchedule] = useState<Confession | null>(null);

  // Auto-publish settings for ETA
  const [publishSettings, setPublishSettings] = useState<{
    interval: number; startHour: number; endHour: number;
  }>({ interval: 120, startHour: 9, endHour: 23 });

  // Growth Cadence Intelligence state
  const [cadenceInfo, setCadenceInfo] = useState<{
    strategy: string;
    mode: string;
    gapMin: number;
    gapMax: number;
    confidence: string;
    evidenceCount: number;
    reason: string;
  } | null>(null);
  const [repairingQueue, setRepairingQueue] = useState(false);
  const [recalculatingQueue, setRecalculatingQueue] = useState(false);

  const { success, error } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all confessions (high limit to get full counts)
      const params = new URLSearchParams();
      params.set('sortBy', 'oldest');
      params.set('limit', '500');

      const [res, tplRes, settingsRes, cadenceRes] = await Promise.all([
        fetch(`/api/confessions?${params.toString()}`),
        fetch('/api/templates'),
        fetch('/api/settings'),
        fetch('/api/growth/cadence').catch(() => null),
      ]);
      const [data, tpls, settings] = await Promise.all([res.json(), tplRes.json(), settingsRes.json()]);

      setAllConfessions(data.confessions || []);
      setTemplates(tpls || []);
      if (settings) {
        setPublishSettings({
          interval: settings.random_gap_enabled !== false ? (settings.current_random_gap_minutes ?? 60) : (settings.auto_publish_interval_minutes ?? 60),
          startHour: settings.auto_publish_start_hour ?? 9,
          endHour: settings.auto_publish_end_hour ?? 22,
        });
      }

      if (cadenceRes && cadenceRes.ok) {
        try {
          const cData = await cadenceRes.json();
          if (cData.success && cData.recommendation) {
            setCadenceInfo({
              strategy: cData.recommendation.strategy,
              mode: cData.recommendation.mode,
              gapMin: cData.recommendation.recommendedGapRangeMinutes?.min ?? 30,
              gapMax: cData.recommendation.recommendedGapRangeMinutes?.max ?? 75,
              confidence: cData.recommendation.confidence,
              evidenceCount: cData.recommendation.evidenceCount,
              reason: cData.recommendation.reason,
            });
          }
        } catch {}
      }
    } catch {
      error('Failed to load confessions');
    } finally {
      setLoading(false);
    }
  }, [error]);

  const handleRepairQueue = async () => {
    setRepairingQueue(true);
    try {
      const res = await fetch('/api/growth/cadence/repair', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Queue repair failed');
      success(`Queue repaired: ${data.result?.repairedCount ?? 0} stale posts rescheduled using ${data.result?.strategy || 'Adaptive Cadence'}`);
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Failed to repair queue');
    } finally {
      setRepairingQueue(false);
    }
  };

  const handleRecalculateSchedule = async () => {
    setRecalculatingQueue(true);
    try {
      const res = await fetch('/api/growth/cadence/recalculate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Recalculation failed');
      success(`Schedule recalculated: ${data.result?.newlyScheduledCount ?? 0} slots aligned to Growth Strategy`);
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Failed to recalculate schedule');
    } finally {
      setRecalculatingQueue(false);
    }
  };

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(1); setSelectedIds([]); }, [activeTab, search, riskFilter]);

  // ─── Section filters ──────────────────────────────────────────────────────
  const queueConfessions = allConfessions.filter(
    (c) => !['PUBLISHED', 'SCHEDULED', 'REJECTED', 'DELETED'].includes(c.status)
  );
  const scheduledConfessions = allConfessions.filter((c) => c.status === 'SCHEDULED');
  const publishedConfessions = allConfessions.filter((c) => c.status === 'PUBLISHED');
  const deletedConfessions = allConfessions.filter((c) => c.status === 'DELETED');
  const failedConfessions = allConfessions.filter(
    (c) =>
      (c.status === 'FAILED' || c.status === 'FAILED_REQUIRES_ACTION') &&
      !c.instagram_media_id &&
      !c.published_at
  );

  // Apply search + risk filter to the active tab list
  const applyFilters = (list: Confession[]) => {
    let filtered = list;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.cleaned_text || c.original_text).toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.display_name.toLowerCase().includes(q)
      );
    }
    if (riskFilter !== 'ALL') {
      filtered = filtered.filter((c) => c.moderation_status === riskFilter);
    }
    return filtered;
  };

  const activeList = applyFilters(
    activeTab === 'queue' ? queueConfessions :
    activeTab === 'scheduled' ? scheduledConfessions :
    activeTab === 'published' ? publishedConfessions :
    deletedConfessions
  );

  const totalPages = Math.max(1, Math.ceil(activeList.length / LIMIT));
  const paginated = activeList.slice((page - 1) * LIMIT, page * LIMIT);

  // ─── ETA helpers ─────────────────────────────────────────────────────────
  const computeETA = (queueIndex: number): Date => {
    const { interval, startHour, endHour } = publishSettings;
    const msInterval = interval * 60 * 1000;
    let slotTime = new Date(Math.ceil(Date.now() / msInterval) * msInterval);
    let slotsRemaining = queueIndex + 1;
    let safety = 0;
    while (slotsRemaining > 0 && safety < 500) {
      safety++;
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(slotTime), 10
      );
      if (hour >= startHour && hour < endHour) {
        slotsRemaining--;
        if (slotsRemaining === 0) break;
      }
      slotTime = new Date(slotTime.getTime() + msInterval);
    }
    return slotTime;
  };

  const formatETA = (date: Date): string => {
    const diff = date.getTime() - Date.now();
    const days = Math.floor(diff / 86400000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dateStr = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    if (diff < 60000) return 'Any moment now';
    if (diff < 3600000) return `~${mins}m from now`;
    return `${dateStr} at ${timeStr}`;
  };

  // ─── Bulk handlers ────────────────────────────────────────────────────────
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) =>
    setSelectedIds(e.target.checked ? paginated.map((c) => c.id) : []);
  const handleSelectOne = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleBulkApprove = async () => {
    if (!confirm(`Approve ${selectedIds.length} confession(s)?`)) return;
    setBulkProcessing(true);
    try {
      await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', ids: selectedIds }),
      });
      success(`${selectedIds.length} approved`);
      setSelectedIds([]);
      loadData();
    } catch { error('Bulk approve failed'); }
    finally { setBulkProcessing(false); }
  };

  const handleBulkReject = async () => {
    if (!confirm(`Reject ${selectedIds.length} confession(s)?`)) return;
    setBulkProcessing(true);
    try {
      await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', ids: selectedIds }),
      });
      success(`${selectedIds.length} rejected`);
      setSelectedIds([]);
      loadData();
    } catch { error('Bulk reject failed'); }
    finally { setBulkProcessing(false); }
  };

  const handleDelete = async (id: string, permanent = false) => {
    const msg = permanent
      ? 'Permanently delete this confession? It will be removed forever and will NEVER be re-imported from Google Sheets.'
      : 'Move this confession to the Deleted archive? Queue timings for remaining posts will be automatically recalculated.';
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/confessions/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      success(permanent ? 'Permanently deleted' : 'Moved to Deleted (queue timings updated)');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Delete failed');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`/api/confessions/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      success('Confession restored to queue (timings updated)');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Restore failed');
    }
  };

  const [restartingQueue, setRestartingQueue] = useState(false);

  const handleRestartQueue = async (targetIds?: string[]) => {
    const isSingle = Boolean(targetIds && targetIds.length === 1);
    const count = targetIds ? targetIds.length : failedConfessions.length;
    if (!isSingle && count > 0 && !confirm(`Restart queue for ${count} failed confession(s)? Rejected and already published posts will NOT be touched.`)) {
      return;
    }
    setRestartingQueue(true);
    try {
      const res = await fetch('/api/confessions/restart-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targetIds, triggerPublish: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to restart queue');
      }
      success(data.message || `Restarted ${data.restartedCount} confessions`);
      setSelectedIds([]);
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Failed to restart queue');
    } finally {
      setRestartingQueue(false);
    }
  };

  const handleBulkRetry = async () => {
    await handleRestartQueue(selectedIds);
  };

  const handleBulkRestore = async () => {
    if (!confirm(`Restore ${selectedIds.length} confession(s) back to queue? Queue schedule will recalculate automatically.`)) return;
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk restore failed');
      success(`${selectedIds.length} restored to queue (timings updated)`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk restore failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (!confirm(`Permanently delete ${selectedIds.length} confession(s)? They will NEVER return or re-import from Google Sheets.`)) return;
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'permanent_delete', ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk permanent delete failed');
      success(`${selectedIds.length} permanently deleted`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk permanent delete failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkSoftDelete = async () => {
    if (!confirm(`Move ${selectedIds.length} confession(s) to Deleted? Queue timings will recalculate automatically.`)) return;
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
      success(`${selectedIds.length} moved to Deleted (queue timings updated)`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk delete failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  // ─── Tab config ───────────────────────────────────────────────────────────
  const tabs: { id: TabType; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    {
      id: 'queue',
      label: 'Upload Queue',
      icon: <ListTodo className="w-4 h-4" />,
      count: queueConfessions.length,
      color: 'indigo',
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      icon: <Clock className="w-4 h-4" />,
      count: scheduledConfessions.length,
      color: 'amber',
    },
    {
      id: 'published',
      label: 'Published',
      icon: <CheckCircle2 className="w-4 h-4" />,
      count: publishedConfessions.length,
      color: 'emerald',
    },
    {
      id: 'deleted',
      label: 'Deleted',
      icon: <Trash2 className="w-4 h-4" />,
      count: deletedConfessions.length,
      color: 'rose',
    },
  ];

  const tabColorMap: Record<string, string> = {
    indigo: 'border-indigo-500 text-indigo-700 bg-indigo-50',
    amber:  'border-amber-500 text-amber-700 bg-amber-50',
    emerald:'border-emerald-500 text-emerald-700 bg-emerald-50',
    rose:   'border-rose-500 text-rose-700 bg-rose-50',
  };
  const badgeColorMap: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-700',
    amber:  'bg-amber-100 text-amber-700',
    emerald:'bg-emerald-100 text-emerald-700',
    rose:   'bg-rose-100 text-rose-700',
  };

  // ─── Render helpers ───────────────────────────────────────────────────────
  const riskBadge = (risk: string) => {
    if (risk === 'HIGH') return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">HIGH</span>;
    if (risk === 'MEDIUM') return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">MEDIUM</span>;
    return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">LOW</span>;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PUBLISHED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      PUBLISHING: 'bg-blue-100 text-blue-700 border-blue-200',
      SCHEDULED: 'bg-amber-100 text-amber-700 border-amber-200',
      APPROVED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      REJECTED: 'bg-rose-100 text-rose-700 border-rose-200',
      FAILED: 'bg-rose-100 text-rose-700 border-rose-200',
      DELETED: 'bg-zinc-100 text-zinc-600 border-zinc-300 line-through',
    };
    const cls = map[status] || 'bg-zinc-100 text-zinc-700 border-zinc-200';
    return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>{status.replace(/_/g, ' ')}</span>;
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Confessions</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {allConfessions.filter(c => c.status !== 'DELETED').length} active · {queueConfessions.length} queued · {publishedConfessions.length} published
              {deletedConfessions.length > 0 && (
                <span className="ml-2 font-semibold text-zinc-500">· {deletedConfessions.length} deleted</span>
              )}
              {failedConfessions.length > 0 && (
                <span className="ml-2 font-semibold text-rose-600">· {failedConfessions.length} failed</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRestartQueue()}
              disabled={restartingQueue}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50 ${
                failedConfessions.length > 0
                  ? 'text-white bg-rose-600 hover:bg-rose-700'
                  : 'text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100'
              }`}
              title="Restart queue for failed confessions (never touches rejected or published posts)"
            >
              <RotateCcw className={`w-4 h-4 ${restartingQueue ? 'animate-spin' : ''}`} />
              {restartingQueue
                ? 'Restarting…'
                : failedConfessions.length > 0
                ? `Restart Failed Queue (${failedConfessions.length})`
                : 'Restart Queue'}
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Failed Alert & Quick Restart Banner ── */}
        {failedConfessions.length > 0 && (
          <div className="flex items-center justify-between p-4 bg-rose-50/90 border border-rose-200 rounded-2xl text-rose-900 gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-100 rounded-xl text-rose-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">
                  {failedConfessions.length} confession{failedConfessions.length > 1 ? 's' : ''} failed to publish
                </div>
                <div className="text-xs text-rose-700 mt-0.5">
                  Click <strong>Restart Queue</strong> to re-attempt publishing. Rejected posts and already published posts will strictly <strong>never</strong> be re-uploaded.
                </div>
              </div>
            </div>
            <button
              onClick={() => handleRestartQueue()}
              disabled={restartingQueue}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all disabled:opacity-50 ml-auto"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
              {restartingQueue ? 'Restarting Queue…' : `Restart Failed Queue (${failedConfessions.length})`}
            </button>
          </div>
        )}

        {/* ── 3 Tabs ── */}
        <div className="flex gap-2 border-b border-zinc-200">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                  isActive
                    ? tabColorMap[tab.color]
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {tab.icon}
                {tab.label}
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? badgeColorMap[tab.color] : 'bg-zinc-100 text-zinc-500'}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Filters bar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search confession text or submitter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-zinc-200 rounded-xl bg-white focus:outline-none"
          >
            <option value="ALL">All Risk Levels</option>
            <option value="LOW">Low Risk</option>
            <option value="MEDIUM">Medium Risk</option>
            <option value="HIGH">High Risk</option>
          </select>

          {activeTab === 'queue' && (
            <button
              onClick={() => handleRestartQueue()}
              disabled={restartingQueue}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors shadow-sm"
              title="Restart queue for failed confessions (never touches rejected or published posts)"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
              {restartingQueue ? 'Restarting…' : 'Restart Queue'}
            </button>
          )}

          {(activeTab === 'queue' || activeTab === 'scheduled') && (
            <>
              <button
                onClick={handleRepairQueue}
                disabled={repairingQueue}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors shadow-sm cursor-pointer"
                title="Repair past-due scheduled posts starting from now without arbitrary shifts"
              >
                <Wrench className={`w-3.5 h-3.5 ${repairingQueue ? 'animate-spin' : ''}`} />
                {repairingQueue ? 'Repairing…' : 'Repair Queue'}
              </button>

              <button
                onClick={handleRecalculateSchedule}
                disabled={recalculatingQueue}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 transition-colors shadow-sm cursor-pointer"
                title="Recalculate queue timestamps using Growth Intelligence cadence strategy"
              >
                <Zap className={`w-3.5 h-3.5 ${recalculatingQueue ? 'animate-spin' : ''}`} />
                {recalculatingQueue ? 'Recalculating…' : 'Recalculate Schedule'}
              </button>
            </>
          )}

          {cadenceInfo && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200/80 text-[11px] text-purple-900 shadow-xs" title={cadenceInfo.reason}>
              <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
              <span className="font-semibold">
                {cadenceInfo.mode === 'growth_optimized'
                  ? 'Growth Optimized'
                  : cadenceInfo.mode === 'baseline'
                  ? 'Baseline Exploration'
                  : cadenceInfo.mode === 'experiment'
                  ? 'Experiment Cadence'
                  : 'Manual Override'}
              </span>
              <span className="text-purple-400">·</span>
              <span className="text-purple-700">{cadenceInfo.gapMin}–{cadenceInfo.gapMax}m gap</span>
              <span className="text-purple-400">·</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white/80 border border-purple-200 text-purple-800">
                {cadenceInfo.confidence} (N={cadenceInfo.evidenceCount})
              </span>
            </div>
          )}

          {/* Bulk actions */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-zinc-600 font-medium">{selectedIds.length} selected</span>
              {activeTab === 'deleted' ? (
                <>
                  <button
                    onClick={handleBulkRestore}
                    disabled={bulkProcessing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                    title="Restore selected confessions to queue"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Restore Selected
                  </button>
                  <button
                    onClick={handleBulkPermanentDelete}
                    disabled={bulkProcessing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors shadow-sm"
                    title="Permanently purge selected confessions"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Permanently Delete
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handleBulkApprove} disabled={bulkProcessing || restartingQueue} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                    <Check className="w-3.5 h-3.5" /> Approve All
                  </button>
                  <button onClick={handleBulkRetry} disabled={bulkProcessing || restartingQueue} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors" title="Restart and retry selected failed confessions">
                    <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} /> Retry Selected
                  </button>
                  <button onClick={handleBulkReject} disabled={bulkProcessing || restartingQueue} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-700 text-white rounded-lg hover:bg-zinc-800 transition-colors">
                    <X className="w-3.5 h-3.5" /> Reject All
                  </button>
                  <button onClick={handleBulkSoftDelete} disabled={bulkProcessing || restartingQueue} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Move to Deleted
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="flex justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-zinc-400 gap-3">
            {activeTab === 'queue' && <ListTodo className="w-10 h-10" />}
            {activeTab === 'scheduled' && <Clock className="w-10 h-10" />}
            {activeTab === 'published' && <CheckCircle2 className="w-10 h-10" />}
            {activeTab === 'deleted' && <Trash2 className="w-10 h-10" />}
            <p className="text-sm font-medium">
              {activeTab === 'queue' && 'No confessions in queue'}
              {activeTab === 'scheduled' && 'No scheduled confessions'}
              {activeTab === 'published' && 'No published confessions yet'}
              {activeTab === 'deleted' && 'No deleted confessions (trash is empty)'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs min-w-[980px]">
                <thead className="bg-zinc-50/70 border-b border-zinc-100 text-zinc-500 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3.5 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === paginated.length && paginated.length > 0}
                        onChange={handleSelectAll}
                        className="rounded border-zinc-300"
                      />
                    </th>
                    <th className="py-3.5 px-3 w-16">Row</th>
                    <th className="py-3.5 px-3 w-32">Submitter</th>
                    <th className="py-3.5 px-4">Confession</th>
                    <th className="py-3.5 px-3 w-24">Risk</th>
                    <th className="py-3.5 px-3 w-28">Status</th>
                    <th className="py-3.5 px-4 w-44">
                      {activeTab === 'queue' && '📅 Estimated Upload'}
                      {activeTab === 'scheduled' && '🕐 Scheduled For'}
                      {activeTab === 'published' && '✅ Published At'}
                      {activeTab === 'deleted' && '🗑️ Deleted At'}
                    </th>
                    <th className="py-3.5 px-4 w-36 text-right pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-medium">
                  {paginated.map((c) => {
                    const qIdx = activeTab === 'queue' ? queueConfessions.findIndex((q) => q.id === c.id) : -1;

                    return (
                      <tr key={c.id} className="hover:bg-zinc-50/60 transition-colors">
                        <td className="py-3.5 px-4 w-10">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(c.id)}
                            onChange={() => handleSelectOne(c.id)}
                            className="rounded border-zinc-300"
                          />
                        </td>

                        <td className="py-3.5 px-3 w-16 font-bold text-zinc-900 whitespace-nowrap">
                          #{String(c.google_sheet_row || 1).padStart(3, '0')}
                        </td>

                        <td className="py-3.5 px-3 w-32 whitespace-nowrap">
                          <div className="font-semibold text-zinc-900">
                            {c.is_anonymous ? 'Anonymous' : c.display_name}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {c.is_anonymous ? `"${c.name}"` : 'Real Name'}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 max-w-sm">
                          <p className="line-clamp-2 text-zinc-700 font-normal leading-relaxed">
                            {c.cleaned_text || c.original_text}
                          </p>
                          {c.moderation_reason && (
                            <p className="text-[10px] text-zinc-400 italic truncate mt-0.5">{c.moderation_reason}</p>
                          )}
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">{riskBadge(c.moderation_status)}</td>

                        <td className="py-3.5 px-3 whitespace-nowrap">{statusBadge(c.status)}</td>

                        {/* Time column — changes per tab */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {activeTab === 'deleted' ? (
                            c.deleted_at ? (
                              <div className="text-[11px]">
                                <div className="text-rose-600 font-semibold">
                                  {new Date(c.deleted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
                                </div>
                                <div className="text-zinc-400">
                                  {new Date(c.deleted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                                </div>
                              </div>
                            ) : <span className="text-zinc-400 text-[11px]">Deleted</span>
                          ) : activeTab === 'published' ? (
                            c.published_at ? (
                              <div className="text-[11px]">
                                <div className="text-emerald-600 font-semibold">
                                  {new Date(c.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
                                </div>
                                <div className="text-zinc-400">
                                  {new Date(c.published_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                                </div>
                              </div>
                            ) : <span className="text-zinc-300 text-[11px]">—</span>
                          ) : activeTab === 'scheduled' ? (
                            c.scheduled_at ? (
                              <div className="text-[11px]">
                                <div className="text-amber-600 font-semibold">
                                  {new Date(c.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
                                </div>
                                <div className="text-zinc-400">
                                  {new Date(c.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                                </div>
                                {c.scheduling_strategy && (
                                  <div className="mt-1">
                                    <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-medium bg-purple-50 text-purple-700 border border-purple-200" title={c.scheduling_reason || undefined}>
                                      <Sparkles className="w-2.5 h-2.5" />
                                      {c.scheduling_strategy === 'BURST_AND_COOLDOWN' ? 'Burst & Cooldown' :
                                       c.scheduling_strategy === 'PEAK_WINDOW_PACING' ? 'Peak Window' :
                                       c.scheduling_strategy === 'OFF_PEAK_SPACING' ? 'Off-Peak Spacing' :
                                       c.scheduling_strategy === 'BALANCED_CADENCE' ? 'Balanced Cadence' :
                                       c.scheduling_strategy === 'EXPLORATORY_BASELINE' ? 'Baseline' :
                                       c.scheduling_strategy === 'EXPERIMENTAL_CADENCE' ? 'Experiment' :
                                       'Manual Override'}
                                      {c.scheduling_gap_minutes ? ` · ${c.scheduling_gap_minutes}m` : ''}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-zinc-300 text-[11px]">—</span>
                          ) : (
                            // Queue tab — show ETA
                            c.status === 'PUBLISHING' ? (
                              <span className="text-[11px] text-blue-500 font-semibold animate-pulse">⏳ Uploading…</span>
                            ) : qIdx >= 0 ? (
                              <div className="text-[11px]">
                                <div className="text-indigo-600 font-semibold">{formatETA(computeETA(qIdx))}</div>
                                <div className="text-zinc-400">
                                  Queue #{qIdx + 1} · {cadenceInfo ? `${cadenceInfo.mode === 'growth_optimized' ? 'Growth' : 'Adaptive'} · ${publishSettings.interval}m gap` : `${publishSettings.interval}m interval`}
                                </div>
                              </div>
                            ) : <span className="text-zinc-300 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {activeTab === 'deleted' ? (
                              <>
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View Details">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                <button
                                  onClick={() => handleRestore(c.id)}
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                                  title="Restore to Queue (auto-updates queue timing)"
                                >
                                  <Undo2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(c.id, true)}
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Permanently Delete (never re-imports)"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                {c.status === 'FAILED' && (
                                  <button
                                    onClick={() => handleRestartQueue([c.id])}
                                    disabled={restartingQueue}
                                    className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                                    title="Restart & Retry this confession"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                )}
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                <button onClick={() => setSelectedForSchedule(c)} className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors" title="Schedule">
                                  <Calendar className="w-4 h-4" />
                                </button>
                                <button onClick={() => setSelectedForPublish(c)} className="p-1.5 rounded-lg text-pink-500 hover:bg-pink-50 transition-colors" title="Publish Now">
                                  <Instagram className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(c.id, false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Move to Deleted">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50/50">
                <p className="text-xs text-zinc-500">
                  Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, activeList.length)} of {activeList.length}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg disabled:opacity-40 hover:bg-zinc-50"
                  >
                    ← Prev
                  </button>
                  <span className="px-3 py-1.5 text-xs font-medium text-zinc-700">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg disabled:opacity-40 hover:bg-zinc-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedForPublish && (
        <PublishModal
          isOpen={Boolean(selectedForPublish)}
          confession={selectedForPublish}
          template={
            templates.find((t) => t.id === selectedForPublish.template_id) ||
            templates.find((t) => t.id === '44444444-4444-4444-4444-444444444444') ||
            templates[0] || {
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
            }
          }
          onClose={() => setSelectedForPublish(null)}
          onSuccess={() => {
            setSelectedForPublish(null);
            loadData();
          }}
        />
      )}
      {selectedForSchedule && (
        <ScheduleModal
          isOpen={Boolean(selectedForSchedule)}
          confession={selectedForSchedule}
          onClose={() => setSelectedForSchedule(null)}
          onSuccess={() => {
            setSelectedForSchedule(null);
            loadData();
          }}
        />
      )}
    </DashboardLayout>
  );
}
