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
  Settings,
  ShieldAlert,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PublishModal } from '@/components/confessions/PublishModal';
import { ScheduleModal } from '@/components/confessions/ScheduleModal';
import { useToast } from '@/components/ui/ToastContext';

type TabType = 'queue' | 'scheduled' | 'published' | 'unknown' | 'duplicates' | 'low_value' | 'deleted';

export default function ConfessionsPage() {
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [tabCounts, setTabCounts] = useState<{
    queue: number;
    scheduled: number;
    published: number;
    unknown: number;
    duplicates: number;
    low_value: number;
    deleted: number;
    failed: number;
    alreadyPublished?: number;
    confirmedNotPublished?: number;
    safeToRetry?: number;
    manualReview?: number;
    unreconciled?: number;
  }>({
    queue: 0,
    scheduled: 0,
    published: 0,
    unknown: 0,
    duplicates: 0,
    low_value: 0,
    deleted: 0,
    failed: 0,
    alreadyPublished: 0,
    confirmedNotPublished: 0,
    safeToRetry: 0,
    manualReview: 0,
    unreconciled: 0,
  });
  const [reconciliationProgress, setReconciliationProgress] = useState<{
    current: number;
    total: number;
    isRunning: boolean;
  } | null>(null);
  const [lastReconciliationReport, setLastReconciliationReport] = useState<any | null>(null);
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

  // Auto-publish settings
  const [publishSettings, setPublishSettings] = useState<{
    interval: number;
    startHour: number;
    endHour: number;
    isRandomGap: boolean;
    jitter: number;
    strategyMode: string;
  }>({
    interval: 180,
    startHour: 9,
    endHour: 22,
    isRandomGap: true,
    jitter: 30,
    strategyMode: 'AUTO',
  });

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
      const params = new URLSearchParams();
      params.set('tab', activeTab);
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      params.set('sortBy', 'oldest');
      if (search.trim()) params.set('search', search.trim());
      if (riskFilter !== 'ALL') params.set('moderationStatus', riskFilter);

      const [countsRes, confRes, tplRes, settingsRes] = await Promise.all([
        fetch('/api/confessions/counts').catch(() => null),
        fetch(`/api/confessions?${params.toString()}`).catch(() => null),
        fetch('/api/templates').catch(() => null),
        fetch('/api/settings').catch(() => null),
      ]);

      if (countsRes && countsRes.ok) {
        try {
          const cData = await countsRes.json();
          if (cData.success && cData.counts) {
            setTabCounts(cData.counts);
          }
        } catch {}
      }

      if (confRes && confRes.ok) {
        try {
          const data = await confRes.json();
          setConfessions(data.confessions || []);
          setTotalCount(data.total || 0);
          setTotalPages(data.totalPages || 1);
        } catch {}
      }

      if (tplRes && tplRes.ok) {
        try {
          const tpls = await tplRes.json();
          setTemplates(tpls || []);
        } catch {}
      }

      if (settingsRes && settingsRes.ok) {
        try {
          const settings = await settingsRes.json();
          if (settings) {
            const isRandom = settings.random_gap_enabled !== false;
            const interval = isRandom
              ? (settings.current_random_gap_minutes ?? settings.auto_publish_interval_minutes ?? 60)
              : (settings.auto_publish_interval_minutes ?? 180);
            setPublishSettings({
              interval,
              startHour: settings.auto_publish_start_hour ?? 9,
              endHour: settings.auto_publish_end_hour ?? 22,
              isRandomGap: isRandom,
              jitter: settings.anti_bot_jitter_minutes ?? 30,
              strategyMode: settings.scheduling_strategy_mode || 'AUTO',
            });
          }
        } catch {}
      }

      // Non-blocking fetch for cadence info
      fetch('/api/growth/cadence')
        .then((r) => (r.ok ? r.json() : null))
        .then((cData) => {
          if (cData && cData.success && cData.recommendation) {
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
        })
        .catch(() => {});
    } catch {
      error('Failed to load confessions');
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, search, riskFilter, error]);

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

  const [reconciling, setReconciling] = useState(false);

  const handleReconcile = async () => {
    setReconciling(true);
    setReconciliationProgress({
      current: 0,
      total: tabCounts.unreconciled || tabCounts.unknown || 0,
      isRunning: true,
    });

    // Poll progress every 750ms while running
    const progressInterval = setInterval(async () => {
      try {
        const pRes = await fetch('/api/confessions/reconcile');
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.progress && pData.progress.isRunning) {
            setReconciliationProgress(pData.progress);
          }
        }
      } catch {}
    }, 750);

    try {
      const res = await fetch('/api/confessions/reconcile', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Reconciliation failed');
      const r = data.report || data.result;
      setLastReconciliationReport(r);
      const pubCount = r.alreadyPublished ?? r.reconciledToPublished ?? 0;
      const dupCount = r.duplicates ?? r.duplicatesFlagged ?? 0;
      const failedCount = r.confirmedNotPublished ?? r.confirmedFailed ?? 0;
      const unkCount = r.unknown ?? 0;
      success(
        `Reconciliation complete: ${pubCount} verified published, ${dupCount} duplicates, ${failedCount} confirmed failed, ${unkCount} unknown.`
      );
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Reconciliation failed');
    } finally {
      clearInterval(progressInterval);
      setReconciling(false);
      setReconciliationProgress(null);
    }
  };

  const handleReconcileSingle = async (id: string) => {
    try {
      const res = await fetch('/api/confessions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confessionId: id, forceLiveInstagram: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Reconciliation failed');
      success(`Reconciliation complete: ${data.reason}`);
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Reconciliation failed');
    }
  };

  const handleResolveDuplicate = async (id: string, resolution: 'MARK_DUPLICATE' | 'ALLOW_POST' | 'CANCEL') => {
    try {
      const res = await fetch('/api/confessions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESOLVE_DUPLICATE', confessionId: id, resolution }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Duplicate resolution failed');
      success(
        resolution === 'ALLOW_POST'
          ? 'Confession approved for posting (override applied).'
          : resolution === 'MARK_DUPLICATE'
          ? 'Marked as duplicate.'
          : 'Cancelled confession.'
      );
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Failed to resolve duplicate');
    }
  };

  useEffect(() => {
    loadData();
    const handleRefresh = () => {
      loadData();
    };
    window.addEventListener('confessionflow:refresh', handleRefresh);
    const pollInterval = setInterval(() => {
      loadData();
    }, 60000);
    return () => {
      window.removeEventListener('confessionflow:refresh', handleRefresh);
      clearInterval(pollInterval);
    };
  }, [loadData]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [activeTab, search, riskFilter]);

  const paginated = confessions;

  // ─── ETA helpers ─────────────────────────────────────────────────────────
  const getCalendarDayDiff = (target: Date, base: Date = new Date()): number => {
    const getDaysSinceEpoch = (d: Date) => {
      // en-CA produces YYYY-MM-DD reliably in Asia/Kolkata
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d).split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return Math.floor(Date.UTC(year, month, day) / 86400000);
    };
    return getDaysSinceEpoch(target) - getDaysSinceEpoch(base);
  };

  const formatETA = (date: Date): string => {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff <= 0) return 'Due now (publishing soon)';
    if (diff < 60000) return 'Any moment now';

    const dayDiff = getCalendarDayDiff(date, now);
    const mins = Math.floor(diff / 60000);

    // If within 45 minutes on the same calendar day
    if (diff < 45 * 60000 && dayDiff === 0) {
      return `~${mins}m from now`;
    }

    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dateStr =
      dayDiff === 0
        ? 'Today'
        : dayDiff === 1
        ? 'Tomorrow'
        : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

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
      // Optimistically update UI so user immediately sees the post move
      if (permanent) {
        setConfessions((prev: Confession[]) => prev.filter((c: Confession) => c.id !== id));
      } else {
        setConfessions((prev: Confession[]) =>
          prev.map((c: Confession) => (c.id === id ? { ...c, status: 'DELETED' as const, deleted_at: new Date().toISOString() } : c))
        );
      }

      const res = await fetch(`/api/confessions/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      success(permanent ? 'Permanently deleted' : 'Moved to Deleted (queue timings updated)');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Delete failed');
      loadData();
    }
  };

  const handleRestore = async (id: string) => {
    try {
      // Optimistically restore in UI
      setConfessions((prev: Confession[]) =>
        prev.map((c: Confession) => (c.id === id ? { ...c, status: 'APPROVED' as const, deleted_at: null } : c))
      );

      const res = await fetch(`/api/confessions/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      success('Confession restored to queue (timings updated)');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Restore failed');
      loadData();
    }
  };

  const [restartingQueue, setRestartingQueue] = useState(false);

  const handleRestartQueue = async (targetIds?: string[]) => {
    const isSingle = Boolean(targetIds && targetIds.length === 1);
    const count = targetIds ? targetIds.length : tabCounts.failed;
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

  const handleQualityOverrideApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/confessions/${encodeURIComponent(id)}/quality-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE', reason: 'Admin manual approval override from Low Value tab' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Quality override failed');
      success('Confession quality-approved and returned to queue!');
      await loadData();
    } catch (err: any) {
      error(err?.message || 'Failed to approve confession');
    }
  };

  // ─── Tab config ───────────────────────────────────────────────────────────
  const tabs: { id: TabType; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    {
      id: 'queue',
      label: 'Upload Queue',
      icon: <ListTodo className="w-4 h-4" />,
      count: tabCounts.queue,
      color: 'indigo',
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      icon: <Clock className="w-4 h-4" />,
      count: tabCounts.scheduled,
      color: 'amber',
    },
    {
      id: 'published',
      label: 'Published',
      icon: <CheckCircle2 className="w-4 h-4" />,
      count: tabCounts.published,
      color: 'emerald',
    },
    ...(tabCounts.unknown > 0
      ? [
          {
            id: 'unknown' as TabType,
            label: 'Requires Review',
            icon: <AlertTriangle className="w-4 h-4" />,
            count: tabCounts.unknown,
            color: 'purple',
          },
        ]
      : []),
    ...(tabCounts.duplicates > 0
      ? [
          {
            id: 'duplicates' as TabType,
            label: 'Duplicates',
            icon: <ShieldAlert className="w-4 h-4" />,
            count: tabCounts.duplicates,
            color: 'orange',
          },
        ]
      : []),
    {
      id: 'low_value',
      label: 'Low Value',
      icon: <ShieldAlert className="w-4 h-4" />,
      count: tabCounts.low_value,
      color: 'slate',
    },
    {
      id: 'deleted',
      label: 'Deleted',
      icon: <Trash2 className="w-4 h-4" />,
      count: tabCounts.deleted,
      color: 'rose',
    },
  ];

  const tabColorMap: Record<string, string> = {
    indigo: 'border-indigo-500 text-indigo-700 bg-indigo-50',
    amber:  'border-amber-500 text-amber-700 bg-amber-50',
    emerald:'border-emerald-500 text-emerald-700 bg-emerald-50',
    purple: 'border-purple-500 text-purple-700 bg-purple-50',
    orange: 'border-amber-500 text-amber-800 bg-amber-50',
    slate:  'border-slate-500 text-slate-700 bg-slate-50',
    rose:   'border-rose-500 text-rose-700 bg-rose-50',
  };
  const badgeColorMap: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-700',
    amber:  'bg-amber-100 text-amber-700',
    emerald:'bg-emerald-100 text-emerald-700',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-amber-100 text-amber-800',
    slate:  'bg-slate-100 text-slate-700',
    rose:   'bg-rose-100 text-rose-700',
  };

  // ─── Render helpers ───────────────────────────────────────────────────────
  const riskBadge = (risk: string) => {
    if (risk === 'HIGH') return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">HIGH</span>;
    if (risk === 'MEDIUM') return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">MEDIUM</span>;
    return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">LOW</span>;
  };

  const statusBadge = (status: string, errorMessage?: string | null, qualityStatus?: string | null) => {
    const map: Record<string, string> = {
      PUBLISHED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      PUBLISHING: 'bg-blue-100 text-blue-700 border-blue-200',
      SCHEDULED: 'bg-amber-100 text-amber-700 border-amber-200',
      APPROVED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      REJECTED: 'bg-rose-100 text-rose-700 border-rose-200',
      FAILED: 'bg-rose-100 text-rose-700 border-rose-200',
      FAILED_CONFIRMED: 'bg-rose-100 text-rose-700 border-rose-200',
      FAILED_REQUIRES_ACTION: 'bg-rose-200 text-rose-900 border-rose-300',
      UNKNOWN: 'bg-purple-100 text-purple-700 border-purple-200',
      UNKNOWN_NEEDS_REVIEW: 'bg-purple-100 text-purple-700 border-purple-200',
      DUPLICATE_ALREADY_PUBLISHED: 'bg-amber-100 text-amber-800 border-amber-200',
      CANCELLED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
      DELETED: 'bg-zinc-100 text-zinc-600 border-zinc-300 line-through',
    };
    const cls = map[status] || 'bg-zinc-100 text-zinc-700 border-zinc-200';
    const isFailed = status === 'FAILED' || status === 'FAILED_REQUIRES_ACTION';
    return (
      <div className="flex flex-col items-start gap-1">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
          {status.replace(/_/g, ' ')}
        </span>
        {qualityStatus === 'LOW_VALUE' && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            LOW VALUE
          </span>
        )}
        {isFailed && errorMessage && (
          <span
            className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded max-w-[190px] truncate block cursor-help font-medium"
            title={errorMessage}
          >
            {errorMessage}
          </span>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Confessions</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {tabCounts.queue + tabCounts.scheduled + tabCounts.unknown + tabCounts.duplicates + tabCounts.failed} active · {tabCounts.queue} queued · {tabCounts.published} published
              {tabCounts.low_value > 0 && (
                <span className="ml-2 font-semibold text-slate-600">· {tabCounts.low_value} low value</span>
              )}
              {tabCounts.deleted > 0 && (
                <span className="ml-2 font-semibold text-zinc-500">· {tabCounts.deleted} deleted</span>
              )}
              {tabCounts.failed > 0 && (
                <span className="ml-2 font-semibold text-rose-600">· {tabCounts.failed} failed</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReconcile}
              disabled={reconciling}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 transition-all disabled:opacity-50 shadow-xs"
              title="Reconcile failed, unknown, and candidate posts against live Instagram API to prevent duplicates"
            >
              <RefreshCw className={`w-4 h-4 ${reconciling ? 'animate-spin' : ''}`} />
              {reconciling ? 'Reconciling…' : 'Reconcile with Instagram'}
            </button>
            <button
              onClick={() => handleRestartQueue()}
              disabled={restartingQueue}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50 ${
                tabCounts.failed > 0
                  ? 'text-white bg-rose-600 hover:bg-rose-700'
                  : 'text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100'
              }`}
              title="Restart queue for failed confessions (never touches rejected or published posts)"
            >
              <RotateCcw className={`w-4 h-4 ${restartingQueue ? 'animate-spin' : ''}`} />
              {restartingQueue
                ? 'Restarting…'
                : tabCounts.failed > 0
                ? `Restart Failed Queue (${tabCounts.failed})`
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

        {/* ── Dynamic Duplicate Protection & Reconciliation Banner ── */}
        {(() => {
          const isReconciling = reconciling || Boolean(reconciliationProgress?.isRunning);
          const hasUnknowns = (tabCounts.unknown || 0) > 0 || (tabCounts.manualReview || 0) > 0;
          const hasUnreconciled = (tabCounts.unreconciled || 0) > 0;
          const hasDuplicates = (tabCounts.duplicates || 0) > 0;

          let badgeText = 'RECONCILIATION COMPLETE';
          let badgeClasses = 'bg-emerald-100 text-emerald-800 border-emerald-300';

          if (isReconciling) {
            badgeText = 'RECONCILIATION RUNNING';
            badgeClasses = 'bg-blue-100 text-blue-800 border-blue-300 animate-pulse';
          } else if (hasUnknowns) {
            badgeText = 'BLOCKED — UNKNOWN STATES';
            badgeClasses = 'bg-rose-100 text-rose-800 border-rose-300';
          } else if (hasUnreconciled) {
            badgeText = 'RECONCILIATION REQUIRED';
            badgeClasses = 'bg-amber-100 text-amber-800 border-amber-300';
          }

          // Show banner if unconfirmed records exist, unknowns exist, duplicates exist, reconciliation is running, or a report is available
          const showBanner = hasUnknowns || hasUnreconciled || hasDuplicates || isReconciling || lastReconciliationReport !== null;
          if (!showBanner) return null;

          const currentCount = reconciliationProgress?.current || 0;
          const totalTarget = reconciliationProgress?.total || (tabCounts.unreconciled || tabCounts.unknown || 1);
          const progressPercent = totalTarget > 0 ? Math.min(100, Math.round((currentCount / totalTarget) * 100)) : 10;

          return (
            <div className="p-4 bg-purple-50/90 border border-purple-200 rounded-2xl text-purple-900 space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-purple-100 rounded-xl text-purple-600 shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-bold text-sm tracking-tight text-purple-950">DUPLICATE PROTECTION</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase ${badgeClasses}`}>
                        {isReconciling && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                        {badgeText}
                      </span>
                    </div>
                    <div className="text-xs text-purple-700 mt-0.5">
                      Submissions are verified against live Instagram media and content hashes. Automated publishing is safely restricted to confirmed records.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  {tabCounts.safeToRetry && tabCounts.safeToRetry > 0 ? (
                    <button
                      onClick={() => handleRestartQueue()}
                      disabled={restartingQueue || isReconciling}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-xl shadow-xs transition-all disabled:opacity-50"
                      title="Only retries posts verified as CONFIRMED_NOT_PUBLISHED"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
                      Retry Confirmed Failed ({tabCounts.safeToRetry})
                    </button>
                  ) : null}
                  <button
                    onClick={handleReconcile}
                    disabled={isReconciling}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                    {isReconciling ? 'Reconciling…' : 'Run Full Reconciliation'}
                  </button>
                </div>
              </div>

              {/* Progress UI during batch reconciliation */}
              {isReconciling && (
                <div className="p-3 bg-white/90 border border-purple-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-purple-900">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 text-purple-600 animate-spin" />
                      Reconciling... {currentCount} / {totalTarget}
                    </span>
                    <span className="text-purple-600 font-mono">{progressPercent}%</span>
                  </div>
                  <div className="w-full bg-purple-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-purple-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Itemized Real Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2 border-t border-purple-200/60">
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Already Published</div>
                  <div className="text-base font-extrabold text-emerald-700 mt-0.5">
                    {tabCounts.alreadyPublished ?? tabCounts.published}
                  </div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Confirmed Failed</div>
                  <div className="text-base font-extrabold text-slate-700 mt-0.5">
                    {tabCounts.confirmedNotPublished ?? tabCounts.failed}
                  </div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Duplicates</div>
                  <div className="text-base font-extrabold text-amber-700 mt-0.5">
                    {tabCounts.duplicates}
                  </div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Unknown</div>
                  <div className="text-base font-extrabold text-rose-700 mt-0.5">
                    {tabCounts.unknown}
                  </div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Manual Review</div>
                  <div className="text-base font-extrabold text-purple-700 mt-0.5">
                    {tabCounts.manualReview ?? 0}
                  </div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-purple-100 shadow-2xs">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Safe to Retry</div>
                  <div className="text-base font-extrabold text-indigo-700 mt-0.5">
                    {tabCounts.safeToRetry ?? 0}
                  </div>
                </div>
              </div>

              {hasUnknowns && (
                <div className="text-[11px] text-rose-800 bg-rose-50/80 border border-rose-200/80 p-2 rounded-lg flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>
                    Auto-publishing is paused for {tabCounts.unknown} item(s) in UNKNOWN state. Run reconciliation or inspect Instagram before retrying.
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Failed Alert & Quick Restart Banner ── */}
        {tabCounts.failed > 0 && (() => {
          const sampleErr = confessions.find((c) => c.error_message)?.error_message;
          const isMissingCreds = sampleErr?.toLowerCase().includes('credentials are not configured');
          const isExpiredToken = sampleErr?.toLowerCase().includes('expired') || sampleErr?.toLowerCase().includes('code 190');
          const isRateLimit = sampleErr?.toLowerCase().includes('limit') || sampleErr?.toLowerCase().includes('quota');

          return (
            <div className="p-4 bg-rose-50/90 border border-rose-200 rounded-2xl text-rose-900 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-100 rounded-xl text-rose-600 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">
                      {tabCounts.failed} confession{tabCounts.failed > 1 ? 's' : ''} failed to publish
                    </div>
                    <div className="text-xs text-rose-700 mt-0.5">
                      Click <strong>Restart Failed Queue</strong> to re-attempt publishing. Rejected posts and already published posts will strictly <strong>never</strong> be re-uploaded.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <Link
                    href="/settings?tab=instagram"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-800 bg-white border border-rose-200 rounded-xl hover:bg-rose-100/50 transition-colors shadow-xs"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Instagram Settings
                  </Link>
                  <button
                    onClick={() => handleRestartQueue()}
                    disabled={restartingQueue}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
                    {restartingQueue ? 'Restarting Queue…' : `Restart Failed Queue (${tabCounts.failed})`}
                  </button>
                </div>
              </div>

              {sampleErr && (
                <div className="pt-2 border-t border-rose-200/60 flex items-start gap-2 text-xs text-rose-800">
                  <span className="font-bold shrink-0 bg-rose-200/70 text-rose-900 px-2 py-0.5 rounded text-[11px]">Recorded Error:</span>
                  <div className="space-y-1">
                    <code className="font-mono text-[11px] bg-white/80 px-2 py-0.5 rounded border border-rose-200 block max-w-2xl break-all">
                      {sampleErr}
                    </code>
                    {isMissingCreds && (
                      <p className="text-[11px] text-rose-700">
                        💡 <strong>Root Cause:</strong> Instagram credentials reset when the Render server restarted. Add <code className="font-mono bg-white px-1 py-0.5 rounded text-[10px]">INSTAGRAM_ACCOUNT_ID</code> and <code className="font-mono bg-white px-1 py-0.5 rounded text-[10px]">INSTAGRAM_ACCESS_TOKEN</code> into Render Dashboard Environment Variables so they persist across restarts.
                      </p>
                    )}
                    {isExpiredToken && (
                      <p className="text-[11px] text-rose-700">
                        💡 <strong>Root Cause:</strong> Meta Access Token has expired. Generate a fresh Long-Lived Token in Meta Graph API Explorer and update Settings.
                      </p>
                    )}
                    {isRateLimit && (
                      <p className="text-[11px] text-rose-700">
                        💡 <strong>Root Cause:</strong> Meta publishing rate limit reached for the rolling 24-hour window. Wait a few hours for the quota to refresh.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

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
            {activeTab === 'low_value' && <ShieldAlert className="w-10 h-10 text-slate-400" />}
            {activeTab === 'deleted' && <Trash2 className="w-10 h-10" />}
            <p className="text-sm font-medium">
              {activeTab === 'queue' && 'No confessions in queue'}
              {activeTab === 'scheduled' && 'No scheduled confessions'}
              {activeTab === 'published' && 'No published confessions yet'}
              {activeTab === 'low_value' && 'No low-value or meaningless submissions found'}
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
                      {activeTab === 'low_value' && '🛡️ Quality Assessment'}
                      {activeTab === 'deleted' && '🗑️ Deleted At'}
                    </th>
                    <th className="py-3.5 px-4 w-36 text-right pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 font-medium">
                  {paginated.map((c) => {
                    const qIdx = activeTab === 'queue' ? confessions.findIndex((q) => q.id === c.id) : -1;

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

                        <td className="py-3.5 px-3 whitespace-nowrap">{statusBadge(c.status, c.error_message, c.quality_status)}</td>

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
                          ) : activeTab === 'low_value' ? (
                            <div className="text-[11px] space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-800">
                                  Score: {c.quality_score ?? 0}/100
                                </span>
                                {c.quality_category && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 uppercase font-mono">
                                    {c.quality_category.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                              <div className="text-zinc-500 text-[10px] max-w-xs truncate" title={c.quality_reason || undefined}>
                                {c.quality_reason || 'Filtered by Confession Quality Gate'}
                              </div>
                            </div>
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
                                {c.why_this_time ? (
                                  <div className="mt-1 flex flex-col gap-0.5">
                                    <span
                                      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-medium border cursor-help w-fit ${
                                        c.why_this_time.startsWith('Growth optimized')
                                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                                          : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                                      }`}
                                      title={c.why_this_time}
                                    >
                                      <Sparkles className="w-2.5 h-2.5 text-purple-600" />
                                      {c.why_this_time.split('(')[0].trim()}
                                    </span>
                                    <span className="text-[8px] text-zinc-400 pl-0.5 cursor-help" title={c.why_this_time}>
                                      Why this time?
                                    </span>
                                  </div>
                                ) : c.scheduling_strategy ? (
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
                                ) : null}
                              </div>
                            ) : <span className="text-zinc-300 text-[11px]">—</span>
                          ) : (
                            // Queue tab — show ETA
                            c.status === 'PUBLISHING' ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-[11px] text-blue-500 font-semibold animate-pulse">⏳ Uploading…</span>
                                <button
                                  onClick={() => handleRestartQueue([c.id])}
                                  disabled={restartingQueue}
                                  className="text-[9px] text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                  title="If upload timed out or got stuck, click to reset back to queue"
                                >
                                  Unstick / Reset
                                </button>
                              </div>
                            ) : c.scheduled_at ? (
                              <div className="text-[11px]">
                                <div className="text-indigo-600 font-semibold">
                                  {formatETA(new Date(c.scheduled_at))}
                                </div>
                                <div className="mt-0.5 flex flex-col gap-0.5">
                                  {(() => {
                                    const prov = c.scheduling_provenance;
                                    const isFixed = prov?.strategy_source === 'CONFIGURED' || (!publishSettings.isRandomGap || publishSettings.strategyMode === 'MANUAL');
                                    const isGrowth = prov?.strategy_source === 'LEARNED' || (!isFixed && cadenceInfo?.mode === 'growth_optimized');
                                    const isExp = prov?.strategy_source === 'EXPERIMENT';
                                    const actualGap = c.scheduling_gap_minutes || (cadenceInfo?.gapMin ?? 45);
                                    const gapHours = Math.floor(actualGap / 60);
                                    const gapMins = actualGap % 60;
                                    const gapLabel = gapHours > 0 ? (gapMins > 0 ? `${gapHours}h ${gapMins}m` : `${gapHours}h`) : `${gapMins}m`;
                                    const badgeLabel = isFixed
                                      ? `Fixed cooldown · ${gapLabel}`
                                      : isExp
                                      ? `Experiment · ${gapLabel}`
                                      : isGrowth
                                      ? `Growth optimized · ${gapLabel}`
                                      : `Baseline exploration · ${gapLabel}`;
                                    const explanation = c.why_this_time || prov?.reason || (isFixed
                                      ? `Fixed cooldown (${publishSettings.interval}m base + jitter)`
                                      : isGrowth
                                      ? `Growth optimized · ${gapLabel} (${cadenceInfo?.reason || 'Empirical peak reach window'})`
                                      : `Baseline exploration · ${gapLabel} (Safe exploratory gap spacing)`);

                                    return (
                                      <>
                                        <span
                                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border w-fit cursor-help ${
                                            isFixed
                                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                                              : isGrowth
                                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                                              : isExp
                                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                                              : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                                          }`}
                                          title={explanation}
                                        >
                                          <Sparkles className={`w-2.5 h-2.5 ${isFixed ? 'text-blue-500' : isGrowth ? 'text-purple-500' : 'text-zinc-400'}`} />
                                          {badgeLabel}
                                        </span>
                                        <span className="text-[8px] text-zinc-400 pl-0.5 cursor-help" title={explanation}>
                                          Why this time?
                                        </span>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            ) : (
                              <div className="text-[11px] text-zinc-400 italic">
                                Pending schedule slot
                              </div>
                            )
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
                            ) : activeTab === 'low_value' ? (
                              <>
                                <button
                                  onClick={() => handleQualityOverrideApprove(c.id)}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer"
                                  title="Approve Anyway (Override AI Quality Filter and return to Queue)"
                                >
                                  <Check className="w-3.5 h-3.5" /> Approve
                                </button>
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                <button
                                  onClick={() => handleDelete(c.id, false)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Move to Deleted"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : activeTab === 'duplicates' ? (
                              <>
                                <button
                                  onClick={() => handleResolveDuplicate(c.id, 'ALLOW_POST')}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer"
                                  title="Override duplicate check and approve for publishing"
                                >
                                  <Check className="w-3.5 h-3.5" /> Allow
                                </button>
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                <button
                                  onClick={() => handleDelete(c.id, false)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Move to Deleted"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : activeTab === 'unknown' ? (
                              <>
                                <button
                                  onClick={() => handleReconcileSingle(c.id)}
                                  disabled={reconciling}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                                  title="Query Instagram API to verify true publication state"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" /> Reconcile
                                </button>
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                <button
                                  onClick={() => handleDelete(c.id, false)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Move to Deleted"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                {/* Only allow Retry for verified failed posts — NEVER for unknown or unconfirmed */}
                                {(c.status === 'FAILED_CONFIRMED' || (c.status === 'FAILED' && c.reconciliation_status === 'CONFIRMED_NOT_PUBLISHED')) && (
                                  <button
                                    onClick={() => handleRestartQueue([c.id])}
                                    disabled={restartingQueue}
                                    className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                                    title="Restart & Retry this verified failed confession"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                )}
                                {/* If in UNKNOWN state, show Reconcile instead of Retry */}
                                {(c.status === 'UNKNOWN' || c.status === 'UNKNOWN_NEEDS_REVIEW' || c.reconciliation_status === 'UNKNOWN' || c.reconciliation_status === 'MANUAL_REVIEW') && (
                                  <button
                                    onClick={() => handleReconcileSingle(c.id)}
                                    disabled={reconciling}
                                    className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 transition-colors"
                                    title="Reconcile with Instagram before retrying"
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                  </button>
                                )}
                                <Link href={`/confessions/${c.id}`} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" title="View">
                                  <Eye className="w-4 h-4" />
                                </Link>
                                {(() => {
                                  const isPublishBlocked =
                                    ['UNKNOWN', 'MANUAL_REVIEW', 'DUPLICATE', 'ALREADY_PUBLISHED'].includes(c.reconciliation_status as any) ||
                                    c.status === 'DUPLICATE_ALREADY_PUBLISHED' ||
                                    c.status === 'UNKNOWN' ||
                                    c.status === 'UNKNOWN_NEEDS_REVIEW' ||
                                    c.status === 'PUBLISHED';

                                  if (isPublishBlocked) return null;

                                  return (
                                    <>
                                      <button onClick={() => setSelectedForSchedule(c)} className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors" title="Schedule">
                                        <Calendar className="w-4 h-4" />
                                      </button>
                                      <button onClick={() => setSelectedForPublish(c)} className="p-1.5 rounded-lg text-pink-500 hover:bg-pink-50 transition-colors" title="Publish Now">
                                        <Instagram className="w-4 h-4" />
                                      </button>
                                    </>
                                  );
                                })()}
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
                  Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, totalCount)} of {totalCount}
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
