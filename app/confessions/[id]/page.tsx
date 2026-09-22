'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  Save,
  Check,
  X,
  Calendar,
  Instagram,
  RefreshCw,
  ShieldAlert,
  FileSpreadsheet,
  Palette,
  AlertTriangle,
  Tag,
  Download,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PostCardPreview } from '@/components/confessions/PostCardPreview';
import { PublishModal } from '@/components/confessions/PublishModal';
import { ScheduleModal } from '@/components/confessions/ScheduleModal';
import { useToast } from '@/components/ui/ToastContext';
import { downloadCardAsPng, downloadAllSlides } from '@/lib/downloadCard';


export default function ConfessionEditorPage({
  params,
}: {
  params?: Promise<{ id: string }> | { id: string };
}) {
  const router = useRouter();
  const routeParams = useParams();
  const { success, error, info } = useToast();

  const [propId, setPropId] = useState<string>('');

  useEffect(() => {
    if (params) {
      Promise.resolve(params).then((resolved) => {
        if (resolved?.id) setPropId(resolved.id);
      });
    }
  }, [params]);

  const confessionId = (routeParams?.id as string) || propId || '';

  const [confession, setConfession] = useState<Confession | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingAI, setProcessingAI] = useState(false);

  // Form edit states
  const [cleanedText, setCleanedText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [caption, setCaption] = useState('');
  const [hashtagsStr, setHashtagsStr] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Modals
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadData = useCallback(async () => {
    if (!confessionId) return;
    try {
      setLoading(true);
      const [confRes, tplRes] = await Promise.all([
        fetch(`/api/confessions/${confessionId}`),
        fetch('/api/templates'),
      ]);

      if (!confRes.ok) throw new Error('Confession not found');
      const confData = await confRes.json();
      const tplData = await tplRes.json();

      setConfession(confData);
      setTemplates(tplData || []);

      // Init form fields
      setCleanedText(confData.cleaned_text || confData.original_text || '');
      setDisplayName(confData.display_name || confData.name || 'Anonymous');
      setIsAnonymous(!!confData.is_anonymous);
      setCaption(confData.caption || '');
      setHashtagsStr((confData.hashtags || []).join(' '));
      setSelectedTemplateId(confData.template_id || tplData[0]?.id);
    } catch (err: any) {
      error(err?.message || 'Failed to load confession');
    } finally {
      setLoading(false);
    }
  }, [confessionId, error]);

  useEffect(() => {
    if (confessionId) {
      loadData();
    }
  }, [confessionId, loadData]);

  const handleSave = async () => {
    if (!confessionId) return;
    setSaving(true);
    try {
      const hashtags = hashtagsStr
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));

      const res = await fetch(`/api/confessions/${confessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaned_text: cleanedText,
          display_name: isAnonymous ? 'Anonymous' : displayName,
          is_anonymous: isAnonymous,
          caption,
          hashtags,
          template_id: selectedTemplateId,
        }),
      });

      if (!res.ok) throw new Error('Failed to save updates');
      const updated = await res.json();
      setConfession(updated);
      success('Confession saved successfully');
    } catch (err: any) {
      error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateAI = async () => {
    if (!confessionId) return;
    setProcessingAI(true);
    try {
      info('AI is refining grammar, generating caption and tags...');
      const res = await fetch(`/api/confessions/${confessionId}/process`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('AI processing failed');
      const updated = await res.json();
      setConfession(updated);
      setCleanedText(updated.cleaned_text);
      setCaption(updated.caption);
      setHashtagsStr((updated.hashtags || []).join(' '));
      success('AI refinement complete');
    } catch (err: any) {
      error(err?.message || 'AI processing error');
    } finally {
      setProcessingAI(false);
    }
  };

  const handleApprove = async () => {
    if (!confessionId) return;
    try {
      const res = await fetch(`/api/confessions/${confessionId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Approval failed');
      success('Approved for publishing');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Error approving');
    }
  };

  const handleReject = async () => {
    if (!confessionId) return;
    const reason = prompt('Enter rejection reason:', 'Content does not meet guidelines');
    if (reason === null) return;
    try {
      const res = await fetch(`/api/confessions/${confessionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Rejection failed');
      success('Confession rejected');
      loadData();
    } catch (err: any) {
      error(err?.message || 'Error rejecting');
    }
  };

  const handleDownloadCard = async () => {
    if (!confession || !activeTemplate) return;
    try {
      setDownloading(true);
      await downloadCardAsPng({
        text: cleanedText,
        displayName: isAnonymous ? 'Anonymous' : displayName,
        isAnonymous,
        confessionNumber: confession.google_sheet_row,
        template: activeTemplate,
      });
      success('Post card downloaded successfully as 1080x1080 PNG!');
    } catch (err: any) {
      error(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAllSlides = async () => {
    if (!confession || !activeTemplate) return;
    try {
      setDownloading(true);
      info('Generating and downloading all slides...');
      const count = await downloadAllSlides({
        text: cleanedText,
        displayName: isAnonymous ? 'Anonymous' : displayName,
        isAnonymous,
        confessionNumber: confession.google_sheet_row,
        template: activeTemplate,
      });
      success(`All ${count} slides downloaded successfully!`);
    } catch (err: any) {
      error(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };


  if (loading) {
    return (
      <DashboardLayout title="Confession Editor">
        <div className="p-24 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading confession editor...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (!confession) {
    return (
      <DashboardLayout title="Confession Editor">
        <div className="p-16 text-center text-zinc-500 text-sm">
          Confession not found.{' '}
          <Link href="/confessions" className="text-brand-600 underline">
            Return to library
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId) || templates[0];

  return (
    <DashboardLayout
      title={`Confession #${String(confession.google_sheet_row || 1).padStart(3, '0')}`}
      subtitle="Review original source submission, refine AI caption, select template, and publish"
    >
      {/* Top Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-zinc-200">
        <Link
          href="/confessions"
          className="flex items-center gap-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Library</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleRegenerateAI}
            disabled={processingAI}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold border border-amber-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${processingAI ? 'animate-spin' : ''}`} />
            <span>{processingAI ? 'Processing...' : 'Regenerate AI'}</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-semibold border border-zinc-200 shadow-sm transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Draft'}</span>
          </button>

          {confession.status !== 'APPROVED' && confession.status !== 'PUBLISHED' && (
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Approve</span>
            </button>
          )}

          {confession.status !== 'REJECTED' && confession.status !== 'PUBLISHED' && (
            <button
              onClick={handleReject}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
          )}

          {confession.status !== 'PUBLISHED' && (
            <button
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Schedule</span>
            </button>
          )}

          <button
            onClick={handleDownloadCard}
            disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            title="Download high-resolution 1080x1080 PNG"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading ? 'Downloading...' : 'Download Post'}</span>
          </button>

          {confession.status !== 'PUBLISHED' ? (
            <button
              onClick={() => setShowPublishModal(true)}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-rose-500 hover:from-brand-700 hover:to-rose-600 text-white text-xs font-semibold shadow-md shadow-brand-500/20 transition-all active:scale-95 cursor-pointer"
            >
              <Instagram className="w-3.5 h-3.5" />
              <span>Publish Now</span>
            </button>
          ) : (
            <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200">
              Already Published
            </span>
          )}
        </div>
      </div>


      {/* Two-Column Editor Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT COLUMN: Original Submission & Metadata (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Source Metadata Card */}
          <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Original Sheet Submission</span>
              </div>
              <span className="text-xs font-semibold text-zinc-500">
                Row #{confession.google_sheet_row}
              </span>
            </div>

            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 text-xs space-y-2.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">Submitted Name:</span>
                <span className="font-semibold text-zinc-900">{confession.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Spreadsheet ID:</span>
                <span className="font-mono text-[11px] text-zinc-700">{confession.google_sheet_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Import Date:</span>
                <span className="text-zinc-700">{new Date(confession.created_at).toLocaleString()}</span>
              </div>
            </div>

            {/* Original Text Box */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                Raw Unedited Submission Text
              </label>
              <div className="p-4 bg-zinc-50/80 rounded-xl border border-zinc-200 text-xs text-zinc-800 leading-relaxed font-sans select-text whitespace-pre-wrap">
                {confession.original_text}
              </div>
            </div>
          </div>

          {/* Moderation & Privacy Assessment Card */}
          <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>Moderation & Safety Analysis</span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  confession.moderation_status === 'HIGH'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : confession.moderation_status === 'MEDIUM'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                {confession.moderation_status} RISK
              </span>
            </div>

            <p className="text-xs text-zinc-600 leading-relaxed">
              {confession.moderation_reason || 'Content passed automated safety checks.'}
            </p>

            {confession.moderation_status === 'HIGH' && (
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>High Risk Warning:</strong> Sensitive contact information or high-risk content detected. Ensure proper masking or verification before publishing.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Processed Content, Live Preview & Template (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Post Card Visual Preview */}
          <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm flex flex-col items-center">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full mb-4 gap-2">
              <div className="flex items-center gap-2 font-bold text-sm text-zinc-900">
                <Instagram className="w-4 h-4 text-brand-500" />
                <span>Live 1080x1080 Instagram Card Preview</span>
              </div>
              <div className="flex items-center gap-2">
                {cleanedText.length > 480 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllSlides}
                    disabled={downloading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    title="Download all slides sequentially"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-600" />
                    <span>Download All Slides</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadCard}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold border border-brand-200/70 transition-colors cursor-pointer disabled:opacity-50"
                  title="Download single 1080x1080 PNG"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{downloading ? 'Exporting...' : 'Download PNG'}</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-zinc-100 rounded-2xl flex items-center justify-center">
              <PostCardPreview
                text={cleanedText}
                displayName={displayName}
                isAnonymous={isAnonymous}
                confessionNumber={confession.google_sheet_row}
                template={activeTemplate}
                scale={0.34}
              />
            </div>

          </div>

          {/* Form Fields for Customization */}
          <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm space-y-5">
            <div className="flex items-center gap-2 font-bold text-sm text-zinc-900 border-b border-zinc-100 pb-3">
              <Palette className="w-4 h-4 text-brand-600" />
              <span>Customize Post Content</span>
            </div>

            {/* Template Selector */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Visual Template</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-800 bg-white focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.font_family})
                  </option>
                ))}
              </select>
            </div>

            {/* Cleaned Confession Text */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Confession Text (Formatted & Cleaned)
              </label>
              <textarea
                rows={4}
                value={cleanedText}
                onChange={(e) => setCleanedText(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
              <p className="text-[11px] text-zinc-600 mt-1">
                {cleanedText.length} characters &bull; Text dynamically fits within 1080x1080 canvas without overflowing.
              </p>
            </div>

            {/* Submitter Name & Anonymous Radio */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isAnonymous}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Attribution Privacy</label>
                <div className="flex items-center gap-4 mt-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-800 cursor-pointer">
                    <input
                      type="radio"
                      name="anon"
                      checked={isAnonymous}
                      onChange={() => setIsAnonymous(true)}
                      className="text-brand-600"
                    />
                    <span>Post as Anonymous</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-800 cursor-pointer">
                    <input
                      type="radio"
                      name="anon"
                      checked={!isAnonymous}
                      onChange={() => setIsAnonymous(false)}
                      className="text-brand-600"
                    />
                    <span>Show Name</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Instagram Caption */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Instagram Caption</label>
              <textarea
                rows={3}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>

            {/* Hashtags */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-zinc-600" />
                <span>Hashtags</span>
              </label>
              <input
                type="text"
                value={hashtagsStr}
                onChange={(e) => setHashtagsStr(e.target.value)}
                placeholder="#confession #campuslife #studentproblems"
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showPublishModal && (
        <PublishModal
          isOpen={showPublishModal}
          onClose={() => setShowPublishModal(false)}
          confession={{
            ...confession,
            cleaned_text: cleanedText,
            display_name: isAnonymous ? 'Anonymous' : displayName,
            caption,
            hashtags: hashtagsStr.split(' ').filter(Boolean),
            template_id: selectedTemplateId,
          }}
          template={activeTemplate}
          onSuccess={() => loadData()}
        />
      )}

      {showScheduleModal && (
        <ScheduleModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          confession={confession}
          onSuccess={() => loadData()}
        />
      )}
    </DashboardLayout>
  );
}
