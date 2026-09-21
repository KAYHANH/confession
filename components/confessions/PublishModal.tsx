'use client';

import React, { useState } from 'react';
import { X, Instagram, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Confession, Template } from '@/types';
import { PostCardPreview } from './PostCardPreview';
import { useToast } from '../ui/ToastContext';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  confession: Confession;
  template: Template;
  onSuccess?: () => void;
}

export function PublishModal({
  isOpen,
  onClose,
  confession,
  template,
  onSuccess,
}: PublishModalProps) {
  const [publishing, setPublishing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { success, error } = useToast();

  if (!isOpen) return null;

  const handlePublish = async () => {
    setPublishing(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/confessions/${confession.id}/publish`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to publish');
      }

      setIsSuccess(true);
      success('Published successfully to Instagram!');
      if (onSuccess) onSuccess();

      setTimeout(() => {
        onClose();
        setIsSuccess(false);
      }, 1800);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Instagram publishing failed');
      error(err?.message || 'Publishing failed');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-8 shadow-2xl border border-zinc-100 relative">
        <button
          onClick={onClose}
          disabled={publishing}
          className="absolute top-6 right-6 p-2 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-rose-400 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
            <Instagram className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-900">Publish to Instagram</h3>
            <p className="text-xs text-zinc-600">Review card design and caption before immediate broadcast</p>
          </div>
        </div>

        {/* Content Preview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6 bg-zinc-50/80 p-5 rounded-2xl border border-zinc-200/60">
          <div className="flex items-center justify-center">
            <PostCardPreview
              text={confession.cleaned_text || confession.original_text}
              displayName={confession.display_name}
              isAnonymous={confession.is_anonymous}
              confessionNumber={confession.google_sheet_row}
              template={template}
              scale={0.24}
            />
          </div>

          <div className="flex flex-col justify-between text-xs space-y-3">
            <div>
              <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1">
                Target Account
              </span>
              <p className="font-semibold text-zinc-900 text-sm">@campusconfessions_official</p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-36 pr-1">
              <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1">
                Instagram Caption
              </span>
              <p className="text-zinc-700 whitespace-pre-wrap leading-relaxed">
                {confession.caption || 'No caption generated yet.'}
              </p>
              <div className="mt-2 text-brand-600 font-medium">
                {(confession.hashtags || []).join(' ')}
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-200">
              <span className="text-zinc-500 font-medium">Schedule:</span>{' '}
              <span className="font-bold text-emerald-700">Immediate Publish</span>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isSuccess && (
          <div className="mb-5 flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>Published successfully!</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={publishing}
            className="px-5 py-2.5 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handlePublish}
            disabled={publishing || isSuccess}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-rose-500 hover:from-brand-700 hover:to-rose-600 text-white text-sm font-semibold shadow-md shadow-brand-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {publishing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Publishing...</span>
              </>
            ) : isSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Published!</span>
              </>
            ) : (
              <>
                <Instagram className="w-4 h-4" />
                <span>Publish Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
