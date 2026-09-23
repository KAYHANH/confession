'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MessageSquareText,
  Clock,
  CheckCircle2,
  CalendarDays,
  Send,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Eye,
  Check,
  X,
  Instagram,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, DashboardStats, ActivityLog, Template } from '@/types';
import { PublishModal } from '@/components/confessions/PublishModal';
import { ScheduleModal } from '@/components/confessions/ScheduleModal';
import { useToast } from '@/components/ui/ToastContext';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentConfessions, setRecentConfessions] = useState<Confession[]>([]);
  const [queue, setQueue] = useState<Confession[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedForPublish, setSelectedForPublish] = useState<Confession | null>(null);
  const [selectedForSchedule, setSelectedForSchedule] = useState<Confession | null>(null);

  const { success, error } = useToast();

  const loadDashboardData = useCallback(async () => {
    try {
      const [statsRes, confRes, queueRes, logRes, tplRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/confessions?limit=6'),
        fetch('/api/confessions?status=SCHEDULED&limit=5'),
        fetch('/api/logs?limit=6'),
        fetch('/api/templates'),
      ]);

      const [statsData, confData, queueData, logData, tplData] = await Promise.all([
        statsRes.json(),
        confRes.json(),
        queueRes.json(),
        logRes.json(),
        tplRes.json(),
      ]);

      setStats(statsData);
      setRecentConfessions(confData.confessions || []);
      setQueue(queueData.confessions || []);
      setActivities(logData.logs || []);
      setTemplates(tplData || []);
    } catch (err: any) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    const onRefresh = () => loadDashboardData();
    window.addEventListener('confessionflow:refresh', onRefresh);
    return () => window.removeEventListener('confessionflow:refresh', onRefresh);
  }, [loadDashboardData]);

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/confessions/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to approve');
      success('Confession approved for publishing');
      loadDashboardData();
    } catch (err: any) {
      error(err?.message || 'Error approving');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/confessions/${id}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reject');
      success('Confession rejected');
      loadDashboardData();
    } catch (err: any) {
      error(err?.message || 'Error rejecting');
    }
  };

  const [restartingQueue, setRestartingQueue] = useState(false);

  const handleRestartQueue = async () => {
    if (!confirm('Restart failed confessions queue? Rejected and already published posts will NOT be touched.')) {
      return;
    }
    setRestartingQueue(true);
    try {
      const res = await fetch('/api/confessions/restart-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerPublish: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to restart queue');
      }
      success(data.message || `Restarted ${data.restartedCount} confessions`);
      loadDashboardData();
    } catch (err: any) {
      error(err?.message || 'Failed to restart queue');
    } finally {
      setRestartingQueue(false);
    }
  };

  const getTemplateForConfession = (tplId?: string) => {
    return templates.find((t) => t.id === tplId) || templates[0];
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'READY_FOR_REVIEW':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">Ready for Review</span>;
      case 'APPROVED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">Approved</span>;
      case 'SCHEDULED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">Scheduled</span>;
      case 'PUBLISHED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">Published</span>;
      case 'REJECTED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">Rejected</span>;
      case 'FAILED':
      case 'FAILED_REQUIRES_ACTION':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-800 border border-red-200">Failed</span>;
      case 'PUBLISHING':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200 animate-pulse">Publishing...</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">{status}</span>;
    }
  };

  return (
    <DashboardLayout title="Platform Overview" subtitle="Monitor confession imports, AI moderation, and Instagram broadcast queue">
      {/* Failed Posts Alert Banner */}
      {stats && stats.failed > 0 && (
        <div className="flex items-center justify-between p-4 bg-rose-50/90 border border-rose-200 rounded-2xl text-rose-900 mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-100 rounded-xl text-rose-600 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-sm">
                {stats.failed} confession{stats.failed > 1 ? 's' : ''} failed to publish
              </div>
              <div className="text-xs text-rose-700 mt-0.5">
                Restarting will re-queue all failed confessions. Rejected and already published posts are strictly protected and will never be touched.
              </div>
            </div>
          </div>
          <button
            onClick={handleRestartQueue}
            disabled={restartingQueue}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all disabled:opacity-50 ml-auto"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
            {restartingQueue ? 'Restarting…' : `Restart Failed Queue (${stats.failed})`}
          </button>
        </div>
      )}

      {/* 24/7 Engine Status & Restart Bar */}
      <div className="flex items-center justify-between p-3.5 bg-white border border-zinc-200/80 rounded-2xl shadow-sm mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-700">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>24/7 Autonomous Publishing Engine</span>
          {stats && stats.failed > 0 && (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold border border-rose-200">
              {stats.failed} failed
            </span>
          )}
        </div>
        <button
          onClick={handleRestartQueue}
          disabled={restartingQueue}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all shadow-sm disabled:opacity-50 ${
            stats && stats.failed > 0
              ? 'bg-rose-600 text-white hover:bg-rose-700'
              : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
          }`}
          title="Restart failed queue and trigger publishing cycle"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${restartingQueue ? 'animate-spin' : ''}`} />
          {restartingQueue ? 'Restarting…' : stats && stats.failed > 0 ? `Restart Failed Queue (${stats.failed})` : 'Restart Queue'}
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        <div className="bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-sm">
          <div className="flex items-center justify-between text-zinc-600 mb-2">
            <span className="text-xs font-medium">Total</span>
            <MessageSquareText className="w-4 h-4 text-zinc-600" />
          </div>
          <div className="text-2xl font-bold text-zinc-900">{stats ? stats.total : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200/70 shadow-sm bg-amber-50/20">
          <div className="flex items-center justify-between text-amber-700 mb-2">
            <span className="text-xs font-medium">Review</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-900">{stats ? stats.pendingReview : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-blue-200/70 shadow-sm bg-blue-50/20">
          <div className="flex items-center justify-between text-blue-700 mb-2">
            <span className="text-xs font-medium">Approved</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-blue-900">{stats ? stats.approved : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-indigo-200/70 shadow-sm bg-indigo-50/20">
          <div className="flex items-center justify-between text-indigo-700 mb-2">
            <span className="text-xs font-medium">Scheduled</span>
            <CalendarDays className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-indigo-900">{stats ? stats.scheduled : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-emerald-200/70 shadow-sm bg-emerald-50/20">
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-xs font-medium">Published</span>
            <Send className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-900">{stats ? stats.published : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-sm">
          <div className="flex items-center justify-between text-zinc-600 mb-2">
            <span className="text-xs font-medium">Rejected</span>
            <XCircle className="w-4 h-4 text-zinc-600" />
          </div>
          <div className="text-2xl font-bold text-zinc-900">{stats ? stats.rejected : '—'}</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-rose-200/70 shadow-sm bg-rose-50/20">
          <div className="flex items-center justify-between text-rose-700 mb-2">
            <span className="text-xs font-medium">Failed</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-900">{stats ? stats.failed : '—'}</div>
        </div>
      </div>

      {/* Main Content Layout: Left 2 Cols (Recent Confessions) & Right 1 Col (Queue & Activity) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Recent Confessions Table */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">Recent Confessions</h2>
                <p className="text-xs text-zinc-600">Latest submissions from Google Sheets</p>
              </div>
              <Link
                href="/confessions"
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 group"
              >
                <span>View All</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {loading ? (
              <div className="p-12 text-center text-zinc-600 text-sm flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading submissions...</span>
              </div>
            ) : recentConfessions.length === 0 ? (
              <div className="p-12 text-center text-zinc-600 text-sm">
                No confessions found. Click <strong>Sync Now</strong> to fetch submissions from Google Sheets.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50/60 border-b border-zinc-100 text-zinc-600 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">ID / Submitter</th>
                      <th className="py-3 px-4">Confession Preview</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-medium">
                    {recentConfessions.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-50/60 transition-colors">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-zinc-900">
                            #{String(c.google_sheet_row || 1).padStart(3, '0')}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {c.is_anonymous ? 'Anonymous' : c.display_name}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="line-clamp-2 text-zinc-700 font-normal leading-relaxed">
                            {c.cleaned_text || c.original_text}
                          </p>
                          {c.moderation_status === 'HIGH' && (
                            <span className="inline-block mt-1 text-[10px] text-rose-700 font-semibold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                              High Risk Flagged
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {getStatusBadge(c.status)}
                          <div className="text-[10px] text-zinc-600 mt-1">
                            {new Date(c.created_at).toLocaleDateString()}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              href={`/confessions/${c.id}`}
                              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                              title="Edit & Preview"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>

                            {c.status === 'READY_FOR_REVIEW' && (
                              <>
                                <button
                                  onClick={() => handleApprove(c.id)}
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                                  title="Approve"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleReject(c.id)}
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Reject"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}

                            {['APPROVED', 'READY_FOR_REVIEW'].includes(c.status) && (
                              <button
                                onClick={() => setSelectedForPublish(c)}
                                className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer"
                                title="Publish Now"
                              >
                                <Instagram className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Publishing Queue & Recent Activity */}
        <div className="space-y-6">
          {/* Publishing Queue */}
          <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Publishing Queue</h3>
                <p className="text-xs text-zinc-600">Upcoming automated broadcasts</p>
              </div>
              <Link href="/calendar" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                Calendar
              </Link>
            </div>

            {queue.length === 0 ? (
              <div className="p-6 text-center text-zinc-600 text-xs bg-zinc-50/50 rounded-xl border border-zinc-100">
                No scheduled posts in the queue.
              </div>
            ) : (
              <div className="space-y-3">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border border-zinc-100 bg-zinc-50/50 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="overflow-hidden">
                      <div className="font-semibold text-zinc-900 truncate">
                        #{String(item.google_sheet_row).padStart(3, '0')} &bull; {item.display_name}
                      </div>
                      <p className="line-clamp-1 text-zinc-600 mt-0.5">
                        {item.cleaned_text || item.original_text}
                      </p>
                      <div className="flex items-center gap-1 text-[11px] text-indigo-600 font-medium mt-1.5">
                        <Clock className="w-3 h-3" />
                        <span>
                          {item.scheduled_at ? new Date(item.scheduled_at).toLocaleString() : 'Pending'}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/confessions/${item.id}`}
                      className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
                    >
                      View
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity Logs */}
          <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Recent Activity</h3>
                <p className="text-xs text-zinc-600">Audit trail of actions</p>
              </div>
              <Link href="/logs" className="text-xs font-semibold text-zinc-600 hover:text-zinc-900">
                All Logs
              </Link>
            </div>

            {activities.length === 0 ? (
              <div className="p-6 text-center text-zinc-600 text-xs bg-zinc-50/50 rounded-xl border border-zinc-100">
                No activity logged yet.
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-start gap-2.5 pb-2.5 border-b border-zinc-100 last:border-0 last:pb-0">
                    <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0 mt-1.5" />
                    <div className="flex-1 overflow-hidden">
                      <div className="font-semibold text-zinc-900 tracking-tight">
                        {act.action.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-zinc-600">
                        {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; {act.entity_type}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Publish Modal */}
      {selectedForPublish && (
        <PublishModal
          isOpen={!!selectedForPublish}
          onClose={() => setSelectedForPublish(null)}
          confession={selectedForPublish}
          template={getTemplateForConfession(selectedForPublish.template_id)}
          onSuccess={() => loadDashboardData()}
        />
      )}

      {/* Schedule Modal */}
      {selectedForSchedule && (
        <ScheduleModal
          isOpen={!!selectedForSchedule}
          onClose={() => setSelectedForSchedule(null)}
          confession={selectedForSchedule}
          onSuccess={() => loadDashboardData()}
        />
      )}
    </DashboardLayout>
  );
}
