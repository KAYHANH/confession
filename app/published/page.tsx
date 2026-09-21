'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ExternalLink,
  Instagram,
  RefreshCw,
  Clock,
  Eye,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession, Template } from '@/types';
import { PostCardPreview } from '@/components/confessions/PostCardPreview';
import { useToast } from '@/components/ui/ToastContext';

export default function PublishedPage() {
  const [publishedPosts, setPublishedPosts] = useState<Confession[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const { error } = useToast();

  const loadPublished = useCallback(async () => {
    setLoading(true);
    try {
      const [confRes, tplRes] = await Promise.all([
        fetch('/api/confessions?status=PUBLISHED&sortBy=recently_published&limit=50'),
        fetch('/api/templates'),
      ]);

      const [confData, tplData] = await Promise.all([confRes.json(), tplRes.json()]);
      setPublishedPosts(confData.confessions || []);
      setTemplates(tplData || []);
    } catch {
      error('Failed to load published posts');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    loadPublished();
  }, [loadPublished]);

  const getTemplate = (tplId?: string) => {
    return templates.find((t) => t.id === tplId) || templates[0];
  };

  return (
    <DashboardLayout
      title="Published Confessions Archive"
      subtitle="History of live Instagram broadcasts with direct permalinks and media IDs"
    >
      <div className="bg-white p-5 rounded-2xl border border-zinc-200/80 shadow-sm mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span>{publishedPosts.length} Broadcasted Stories</span>
        </div>
      </div>

      {loading ? (
        <div className="p-20 text-center text-zinc-500 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading published archive...</span>
        </div>
      ) : publishedPosts.length === 0 ? (
        <div className="bg-white p-16 rounded-2xl border border-zinc-200/80 text-center shadow-sm max-w-xl mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-500 mx-auto mb-4">
            <Instagram className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-zinc-900">No Published Posts Yet</h3>
          <p className="text-xs text-zinc-500 mt-1 mb-6">
            Posts that have been successfully broadcasted to Instagram will appear here.
          </p>
          <Link
            href="/review"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold"
          >
            Review Incoming Posts
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {publishedPosts.map((c) => {
            const template = getTemplate(c.template_id);

            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow"
              >
                <div>
                  {/* Top Bar */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-bold text-sm text-zinc-900">
                      Confession #{String(c.google_sheet_row || 1).padStart(3, '0')}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Live</span>
                    </span>
                  </div>

                  {/* Card Visual Thumbnail */}
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

                  {/* Caption & Metadata */}
                  <div className="text-xs space-y-2 mb-4">
                    <p className="line-clamp-2 text-zinc-700 font-normal leading-relaxed">
                      {c.caption}
                    </p>

                    <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-400" />
                        {c.published_at ? new Date(c.published_at).toLocaleString() : 'Recently'}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {c.instagram_media_id ? `ID: ${c.instagram_media_id.slice(-8)}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
                  <Link
                    href={`/confessions/${c.id}`}
                    className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Details</span>
                  </Link>

                  {c.instagram_permalink && (
                    <a
                      href={c.instagram_permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold border border-brand-200 transition-colors"
                    >
                      <Instagram className="w-3.5 h-3.5" />
                      <span>View on Instagram</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
