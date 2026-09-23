'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  Filter,
  Eye,
  Check,
  X,
  Instagram,
  Calendar,
  Sparkles,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PublishModal } from '@/components/confessions/PublishModal';
import { ScheduleModal } from '@/components/confessions/ScheduleModal';
import { useToast } from '@/components/ui/ToastContext';

export default function ConfessionsPage() {
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [templateFilter, setTemplateFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Modals
  const [selectedForPublish, setSelectedForPublish] = useState<Confession | null>(null);
  const [selectedForSchedule, setSelectedForSchedule] = useState<Confession | null>(null);

  // Auto-publish settings for ETA calculation
  const [publishSettings, setPublishSettings] = useState<{
    interval: number; startHour: number; endHour: number; enabled: boolean;
  }>({ interval: 120, startHour: 9, endHour: 23, enabled: false });

  const { success, error } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (riskFilter !== 'ALL') params.set('moderationStatus', riskFilter);
      if (templateFilter !== 'ALL') params.set('templateId', templateFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('sortBy', sortBy);
      params.set('page', page.toString());
      params.set('limit', '20');

      const [res, tplRes, settingsRes] = await Promise.all([
        fetch(`/api/confessions?${params.toString()}`),
        fetch('/api/templates'),
        fetch('/api/settings'),
      ]);

      const [data, tpls, settings] = await Promise.all([res.json(), tplRes.json(), settingsRes.json()]);

      setConfessions(data.confessions || []);
      setTotalPages(data.totalPages || 1);
      setTemplates(tpls || []);
      if (settings) {
        setPublishSettings({
          interval: settings.auto_publish_interval_minutes ?? 120,
          startHour: settings.auto_publish_start_hour ?? 9,
          endHour: settings.auto_publish_end_hour ?? 23,
          enabled: settings.auto_publish_enabled ?? false,
        });
      }
    } catch (err: any) {
      error('Failed to load confessions');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, riskFilter, templateFilter, search, sortBy, page, error]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Compute estimated upload time for a confession given its queue position (0-indexed).
   * Skips slots that fall outside active hours (startHour–endHour IST).
   */
  const computeETA = (queueIndex: number): Date => {
    const { interval, startHour, endHour } = publishSettings;
    let slotTime = new Date();
    // Round up to next slot boundary
    const msInterval = interval * 60 * 1000;
    slotTime = new Date(Math.ceil(slotTime.getTime() / msInterval) * msInterval);

    let slotsRemaining = queueIndex + 1;
    let safety = 0;
    while (slotsRemaining > 0 && safety < 500) {
      safety++;
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(slotTime),
        10,
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
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dateStr = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

    if (diff < 60000) return 'Any moment now';
    if (diff < 3600000) return `~${mins}m from now`;
    return `${dateStr}, ${timeStr}`;
  };

  // Build queue index map: only unpublished confessions in ascending row order
  const pendingQueue = confessions.filter(
    (c) => !['PUBLISHED', 'REJECTED', 'PUBLISHING'].includes(c.status)
  );

  // Bulk Handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(confessions.map((c) => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBulkApprove = async () => {
    if (!confirm(`Are you sure you want to approve ${selectedIds.length} confession(s)?`)) return;
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', ids: selectedIds }),
      });
      if (!res.ok) throw new Error('Bulk approve failed');
      success(`Successfully approved ${selectedIds.length} confession(s)`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk approve failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    const reason = prompt('Please enter a rejection reason for selected confessions:', 'Bulk rejected by Admin');
    if (reason === null) return;

    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', ids: selectedIds, reason }),
      });
      if (!res.ok) throw new Error('Bulk reject failed');
      success(`Rejected ${selectedIds.length} confession(s)`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk reject failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkProcessAI = async () => {
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process', ids: selectedIds }),
      });
      if (!res.ok) throw new Error('Bulk processing failed');
      success(`AI re-processed ${selectedIds.length} confession(s)`);
      setSelectedIds([]);
      loadData();
    } catch (err: any) {
      error(err?.message || 'Bulk process failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this confession?')) return;
    try {
      const res = await fetch(`/api/confessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      success('Confession deleted');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Delete failed');
    }
  };

  const getTemplateForConfession = (tplId?: string) => {
    // Use confession's assigned template, then system default (Deep Story), then first available
    const DEFAULT_TEMPLATE_ID = '77777777-7777-7777-7777-777777777777';
    return (
      templates.find((t) => t.id === tplId) ||
      templates.find((t) => t.id === DEFAULT_TEMPLATE_ID) ||
      templates[0]
    );
  };

  return (
    <DashboardLayout title="Confessions Library" subtitle="Search, filter, edit, and moderate all submitted stories">
      {/* Controls Bar */}
      <div className="bg-white p-5 rounded-2xl border border-zinc-200/80 shadow-sm mb-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by confession text or submitter name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
            <div className="flex items-center gap-1 text-zinc-500 mr-1">
              <Filter className="w-3.5 h-3.5" />
              <span>Filters:</span>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="READY_FOR_REVIEW">Ready for Review</option>
              <option value="APPROVED">Approved</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="PUBLISHED">Published</option>
              <option value="REJECTED">Rejected</option>
              <option value="FAILED">Failed</option>
            </select>

            <select
              value={riskFilter}
              onChange={(e) => {
                setRiskFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Risk Levels</option>
              <option value="LOW">Low Risk</option>
              <option value="MEDIUM">Medium Risk</option>
              <option value="HIGH">High Risk</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="scheduled">Scheduled Date</option>
              <option value="recently_published">Recently Published</option>
            </select>
          </div>
        </div>

        {/* Bulk Action Bar (Visible when items selected) */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 text-white text-xs font-semibold animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-400" />
              <span>{selectedIds.length} confession(s) selected</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkProcessAI}
                disabled={bulkProcessing}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Process AI</span>
              </button>

              <button
                onClick={handleBulkApprove}
                disabled={bulkProcessing}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve</span>
              </button>

              <button
                onClick={handleBulkReject}
                disabled={bulkProcessing}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confessions Table */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading confessions...</span>
          </div>
        ) : confessions.length === 0 ? (
          <div className="p-16 text-center text-zinc-500 text-sm">
            No confessions match the selected filters or search query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50/70 border-b border-zinc-100 text-zinc-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === confessions.length && confessions.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th className="py-3 px-4">Row / ID</th>
                  <th className="py-3 px-4">Submitter</th>
                  <th className="py-3 px-4 max-w-sm">Confession Text</th>
                  <th className="py-3 px-4">Risk</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">📅 Upload Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium">
                {confessions.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="py-3.5 px-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(c.id)}
                        onChange={() => handleSelectOne(c.id)}
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap font-bold text-zinc-900">
                      #{String(c.google_sheet_row || 1).padStart(3, '0')}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-semibold text-zinc-900">
                        {c.is_anonymous ? 'Anonymous' : c.display_name}
                      </div>
                      <div className="text-[10px] text-zinc-600">
                        {c.is_anonymous ? `Submitted: "${c.name}"` : 'Real Name'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 max-w-sm">
                      <p className="line-clamp-2 text-zinc-700 font-normal leading-relaxed">
                        {c.cleaned_text || c.original_text}
                      </p>
                      {c.moderation_reason && (
                        <p className="text-[10px] text-zinc-600 truncate mt-1 italic">
                          {c.moderation_reason}
                        </p>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {c.moderation_status === 'HIGH' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          HIGH
                        </span>
                      )}
                      {c.moderation_status === 'MEDIUM' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          MEDIUM
                        </span>
                      )}
                      {c.moderation_status === 'LOW' && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          LOW
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Upload Time / ETA */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {c.status === 'PUBLISHED' && c.published_at ? (
                        <div className="text-[11px]">
                          <div className="text-emerald-600 font-semibold">✅ Published</div>
                          <div className="text-zinc-400">
                            {new Date(c.published_at).toLocaleString('en-IN', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
                            })}
                          </div>
                        </div>
                      ) : c.status === 'REJECTED' ? (
                        <span className="text-[11px] text-rose-400">—</span>
                      ) : c.status === 'PUBLISHING' ? (
                        <span className="text-[11px] text-blue-500 font-semibold animate-pulse">⏳ Uploading…</span>
                      ) : publishSettings.enabled ? (
                        (() => {
                          const qIdx = pendingQueue.findIndex((q) => q.id === c.id);
                          if (qIdx === -1) return <span className="text-[11px] text-zinc-300">—</span>;
                          const eta = computeETA(qIdx);
                          return (
                            <div className="text-[11px]">
                              <div className="text-indigo-600 font-semibold">{formatETA(eta)}</div>
                              <div className="text-zinc-400">Queue #{qIdx + 1} • every {publishSettings.interval}m</div>
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-[11px] text-zinc-400">Auto-publish OFF</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/confessions/${c.id}`}
                          className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                          title="View / Edit"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>

                        <button
                          onClick={() => setSelectedForSchedule(c)}
                          className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                          title="Schedule Post"
                        >
                          <Calendar className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setSelectedForPublish(c)}
                          className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                          title="Publish Now"
                        >
                          <Instagram className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded-lg text-zinc-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Publish Modal */}
      {selectedForPublish && (
        <PublishModal
          isOpen={!!selectedForPublish}
          onClose={() => setSelectedForPublish(null)}
          confession={selectedForPublish}
          template={getTemplateForConfession(selectedForPublish.template_id)}
          onSuccess={() => loadData()}
        />
      )}

      {/* Schedule Modal */}
      {selectedForSchedule && (
        <ScheduleModal
          isOpen={!!selectedForSchedule}
          onClose={() => setSelectedForSchedule(null)}
          confession={selectedForSchedule}
          onSuccess={() => loadData()}
        />
      )}
    </DashboardLayout>
  );
}
