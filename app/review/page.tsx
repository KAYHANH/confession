'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Check,
  X,
  Edit,
  RefreshCw,
  ShieldCheck,
  Download,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PostCardPreview } from '@/components/confessions/PostCardPreview';
import { useToast } from '@/components/ui/ToastContext';
import { downloadCardAsPng } from '@/lib/downloadCard';


export default function ReviewQueuePage() {
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const { success, error } = useToast();

  const loadReviewQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [confRes, tplRes] = await Promise.all([
        fetch('/api/confessions?status=READY_FOR_REVIEW&sortBy=newest&limit=50'),
        fetch('/api/templates'),
      ]);

      const [confData, tplData] = await Promise.all([confRes.json(), tplRes.json()]);
      setConfessions(confData.confessions || []);
      setTemplates(tplData || []);
    } catch (err: any) {
      error('Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    loadReviewQueue();
  }, [loadReviewQueue]);

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/confessions/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to approve');
      success('Confession approved');
      setConfessions((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      error(err?.message || 'Error approving');
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Rejection reason:', 'Does not meet community standards');
    if (reason === null) return;
    try {
      const res = await fetch(`/api/confessions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      success('Confession rejected');
      setConfessions((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      error(err?.message || 'Error rejecting');
    }
  };

  const handleBulkApprove = async () => {
    if (!confirm(`Approve ${selectedIds.length} confession(s) for publishing?`)) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', ids: selectedIds }),
      });
      if (!res.ok) throw new Error('Bulk approve failed');
      success(`Approved ${selectedIds.length} confession(s)`);
      setSelectedIds([]);
      loadReviewQueue();
    } catch (err: any) {
      error(err?.message || 'Bulk approve failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    const reason = prompt('Rejection reason for selected confessions:', 'Bulk rejected by Admin');
    if (reason === null) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/confessions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', ids: selectedIds, reason }),
      });
      if (!res.ok) throw new Error('Bulk reject failed');
      success(`Rejected ${selectedIds.length} confession(s)`);
      setSelectedIds([]);
      loadReviewQueue();
    } catch (err: any) {
      error(err?.message || 'Bulk reject failed');
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const getTemplate = (tplId?: string) => {
    return templates.find((t) => t.id === tplId) || templates[0];
  };

  const handleDownload = async (c: Confession) => {
    const template = getTemplate(c.template_id);
    if (!template) return;
    try {
      await downloadCardAsPng({
        text: c.cleaned_text || c.original_text || '',
        displayName: c.display_name,
        isAnonymous: c.is_anonymous,
        confessionNumber: c.google_sheet_row,
        template,
      });
      success(`Confession #${String(c.google_sheet_row || 1).padStart(3, '0')} downloaded!`);
    } catch (err: any) {
      error(err?.message || 'Download failed');
    }
  };


  return (
    <DashboardLayout
      title="Admin Review Queue"
      subtitle="Rapidly triage incoming confessions before publishing or scheduling"
    >
      {/* Top Action & Bulk Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <Inbox className="w-5 h-5 text-amber-500" />
          <span>{confessions.length} Submissions Awaiting Decision</span>
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="text-zinc-600 mr-2">{selectedIds.length} selected</span>
            <button
              onClick={handleBulkApprove}
              disabled={processing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Bulk Approve</span>
            </button>
            <button
              onClick={handleBulkReject}
              disabled={processing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Bulk Reject</span>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSelectedIds(confessions.map((c) => c.id))}
            disabled={confessions.length === 0}
            className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 transition-colors disabled:opacity-40"
          >
            Select All
          </button>
        )}
      </div>

      {/* Grid of Cards */}
      {loading ? (
        <div className="p-20 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading review queue...</span>
        </div>
      ) : confessions.length === 0 ? (
        <div className="bg-white p-16 rounded-2xl border border-zinc-200/80 text-center shadow-sm max-w-xl mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mx-auto mb-4">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-zinc-900">Review Queue is Empty!</h3>
          <p className="text-xs text-zinc-600 mt-1 mb-6">
            All submitted confessions have been moderated and approved or scheduled.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold"
          >
            Back to Dashboard
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {confessions.map((c) => {
            const isSelected = selectedIds.includes(c.id);
            const template = getTemplate(c.template_id);

            return (
              <div
                key={c.id}
                className={`bg-white rounded-2xl border transition-all p-6 shadow-sm flex flex-col justify-between ${
                  isSelected ? 'border-brand-500 ring-2 ring-brand-500/10' : 'border-zinc-200/80 hover:border-zinc-300'
                }`}
              >
                {/* Header */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <span className="font-bold text-sm text-zinc-900">
                          Confession #{String(c.google_sheet_row || 1).padStart(3, '0')}
                        </span>
                        <div className="text-[11px] text-zinc-600">
                          {c.is_anonymous ? 'Anonymous' : c.display_name} &bull; Row {c.google_sheet_row}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        c.moderation_status === 'HIGH'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : c.moderation_status === 'MEDIUM'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      {c.moderation_status} RISK
                    </span>
                  </div>

                  {/* Visual Card + Preview snippet */}
                  <div className="flex items-center justify-center p-3 bg-zinc-50 rounded-xl border border-zinc-100 mb-4">
                    <PostCardPreview
                      text={c.cleaned_text || c.original_text}
                      displayName={c.display_name}
                      isAnonymous={c.is_anonymous}
                      confessionNumber={c.google_sheet_row}
                      template={template}
                      scale={0.25}
                    />
                  </div>

                  {/* Caption excerpt */}
                  <div className="text-xs bg-zinc-50/70 p-3 rounded-xl border border-zinc-100 text-zinc-700 space-y-1 mb-4">
                    <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block">
                      Generated Caption
                    </span>
                    <p className="line-clamp-2 leading-relaxed">
                      {c.caption || 'No caption generated yet.'}
                    </p>
                  </div>

                  {c.moderation_reason && (
                    <div className="text-[11px] text-zinc-600 italic mb-4">
                      {c.moderation_reason}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100 mt-2">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/confessions/${c.id}`}
                      className="flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Edit Post</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDownload(c)}
                      className="flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-brand-600 transition-colors cursor-pointer"
                      title="Download 1080x1080 PNG image"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  </div>


                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReject(c.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50/60 hover:bg-rose-100 text-xs font-semibold cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      onClick={() => handleApprove(c.id)}
                      className="flex items-center gap-1 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
