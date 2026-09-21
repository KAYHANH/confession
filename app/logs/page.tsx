'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollText,
  Filter,
  RefreshCw,
  Clock,
  ShieldAlert,
  Send,
  Sparkles,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ActivityLog } from '@/types';
import { useToast } from '@/components/ui/ToastContext';

export default function LogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  const { error } = useToast();

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        selectedAction === 'ALL'
          ? '/api/logs?limit=100'
          : `/api/logs?action=${selectedAction}&limit=100`;
      const res = await fetch(url);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  }, [selectedAction, error]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getActionBadge = (action: string) => {
    if (action.includes('PUBLISHED')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
          <Send className="w-3 h-3" />
          <span>PUBLISHED</span>
        </span>
      );
    }
    if (action.includes('FAILED')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
          <XCircle className="w-3 h-3" />
          <span>FAILED</span>
        </span>
      );
    }
    if (action.includes('MODERATION')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
          <ShieldAlert className="w-3 h-3" />
          <span>MODERATION</span>
        </span>
      );
    }
    if (action.includes('AI_PROCESSED')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
          <Sparkles className="w-3 h-3" />
          <span>AI PROCESSED</span>
        </span>
      );
    }
    if (action.includes('SHEET')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
          <FileSpreadsheet className="w-3 h-3" />
          <span>SHEET SYNC</span>
        </span>
      );
    }
    return (
      <span className="text-[11px] font-bold text-zinc-700 bg-zinc-100 px-2.5 py-1 rounded-full border border-zinc-200">
        {action.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <DashboardLayout
      title="System Activity & Audit Logs"
      subtitle="Complete chronological history of pipeline actions, approvals, and Instagram broadcasts"
    >
      {/* Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <ScrollText className="w-4 h-4 text-brand-500" />
          <span>{logs.length} Recorded Events</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-zinc-500 font-medium">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Event:</span>
          </div>

          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-zinc-200 bg-white font-semibold text-zinc-800 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Actions</option>
            <option value="SHEET_SYNC">Sheet Sync</option>
            <option value="AI_PROCESSED">AI Processed</option>
            <option value="MODERATION_FLAGGED">Moderation Flagged</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="PUBLISHED">Published</option>
            <option value="PUBLISH_FAILED">Publish Failed</option>
            <option value="INSTAGRAM_CONNECTED">Instagram Connected</option>
          </select>

          <button
            onClick={loadLogs}
            className="p-2 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            title="Refresh logs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading activity logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center text-zinc-500 text-xs">
            No events match the selected action filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50/70 border-b border-zinc-100 text-zinc-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity Type</th>
                  <th className="py-3 px-4">Target ID</th>
                  <th className="py-3 px-4">Details / Metadata</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-medium">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-zinc-50/70 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-zinc-600 uppercase font-semibold text-[10px]">
                      {log.entity_type}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-zinc-500">
                      {log.entity_id ? log.entity_id.slice(0, 16) + '...' : '—'}
                    </td>

                    <td className="py-3.5 px-4 max-w-md">
                      <div className="truncate text-zinc-700 font-mono text-[11px]">
                        {JSON.stringify(log.metadata)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap text-zinc-500 flex items-center justify-end gap-1.5 mt-1">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Metadata Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-zinc-100">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
              <h3 className="text-sm font-bold text-zinc-900">
                Log Event: {selectedLog.action}
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-xs text-zinc-400 hover:text-zinc-600"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs mb-6">
              <div>
                <span className="font-semibold text-zinc-500">Log ID:</span>{' '}
                <span className="font-mono text-zinc-800">{selectedLog.id}</span>
              </div>
              <div>
                <span className="font-semibold text-zinc-500">Target Entity:</span>{' '}
                <span className="text-zinc-800">
                  {selectedLog.entity_type} ({selectedLog.entity_id || 'system'})
                </span>
              </div>
              <div>
                <span className="font-semibold text-zinc-500">Recorded At:</span>{' '}
                <span className="text-zinc-800">{new Date(selectedLog.created_at).toUTCString()}</span>
              </div>

              <div>
                <span className="font-semibold text-zinc-500 block mb-1">Payload Metadata:</span>
                <pre className="p-3 bg-zinc-900 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-52">
                  {JSON.stringify(selectedLog.metadata, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
