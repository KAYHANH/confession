'use client';

import React, { useState } from 'react';
import {
  X,
  Instagram,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Layers,
  FileText,
  Scissors,
  Download,
} from 'lucide-react';
import { Confession, Template } from '@/types';
import { PostCardPreview } from './PostCardPreview';
import { useToast } from '../ui/ToastContext';
import { downloadCardAsPng, downloadAllSlides } from '@/lib/downloadCard';
import { SmartContentPreparation } from '../growth/SmartContentPreparation';
import {
  paginateConfession,
  buildInstagramCaption,
  createHookText,
  validatePublicationPayload,
} from '@/lib/paginationEngine';

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

  const fullText = (confession.cleaned_text || confession.original_text || '').trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const pagination = paginateConfession(fullText);
  const totalSlides = pagination.totalSlides;
  const slides = pagination.slides.map((s) => s.text);
  const isMultiSlide = totalSlides > 1;
  const isLong = isMultiSlide || wordCount > 80;

  const [cardMode, setCardMode] = useState<'fit' | 'hook' | 'carousel'>(
    isMultiSlide ? 'carousel' : 'fit'
  );
  const [currentSlide, setCurrentSlide] = useState(0);
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  let currentTextToRender = fullText;
  if (cardMode === 'carousel') {
    currentTextToRender = slides[currentSlide] || fullText;
  } else if (cardMode === 'hook') {
    currentTextToRender = createHookText(fullText);
  } else {
    currentTextToRender = fullText;
  }

  const previewCaption = buildInstagramCaption({
    confessionNumber: confession.google_sheet_row || 1,
    hashtags: confession.hashtags || [],
    mode: cardMode,
    sourceConfession: fullText,
  });

  const handlePublish = async () => {
    setPublishing(true);
    setErrorMessage(null);

    // Pre-flight payload validation
    const validation = validatePublicationPayload({
      sourceConfession: fullText,
      slides: cardMode === 'carousel' ? slides : [currentTextToRender],
      mode: cardMode,
      caption: previewCaption,
    });

    if (!validation.valid) {
      setErrorMessage(validation.errors.join(' '));
      error(validation.errors[0]);
      setPublishing(false);
      return;
    }

    try {
      const res = await fetch(`/api/confessions/${confession.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardMode,
          templateId: template.id,
          customCaption: previewCaption,
        }),
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

  const handleDownloadCurrent = async () => {
    try {
      setDownloading(true);
      await downloadCardAsPng({
        text: currentTextToRender,
        displayName: confession.display_name,
        isAnonymous: confession.is_anonymous,
        confessionNumber: confession.google_sheet_row,
        template,
        mode: cardMode,
        slideIndex: currentSlide,
        totalSlides: cardMode === 'carousel' ? slides.length : 1,
      });
      success('Post card downloaded as 1080x1080 PNG!');
    } catch (err: any) {
      error(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    try {
      setDownloading(true);
      const count = await downloadAllSlides({
        text: fullText,
        displayName: confession.display_name,
        isAnonymous: confession.is_anonymous,
        confessionNumber: confession.google_sheet_row,
        template,
      });
      success(`All ${count} slides downloaded!`);
    } catch (err: any) {
      error(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-3xl w-full p-7 shadow-2xl border border-zinc-100 relative max-h-[95vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={publishing}
          className="absolute top-6 right-6 p-2 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-rose-400 flex items-center justify-center text-white shadow-md shadow-brand-500/20 shrink-0">
            <Instagram className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-900">Publish to Instagram</h3>
            <p className="text-xs text-zinc-600">Review card design and caption before immediate broadcast</p>
          </div>
        </div>

        {/* Content Length & Layout Mode Selector */}
        {isLong && (
          <div className="mb-4 p-3 bg-brand-50/70 border border-brand-200/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-brand-900">
              <Layers className="w-4 h-4 text-brand-600 shrink-0" />
              <span>
                Story Length: {wordCount} words — {isMultiSlide ? `Auto Carousel (${totalSlides} Slides)` : 'Single Post'}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl shadow-xs border border-brand-200 text-xs">
              <button
                type="button"
                onClick={() => setCardMode('fit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  cardMode === 'fit'
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Fit in 1 Card</span>
              </button>
              <button
                type="button"
                onClick={() => setCardMode('hook')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  cardMode === 'hook'
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Hook + Caption</span>
              </button>
              {isMultiSlide && (
                <button
                  type="button"
                  onClick={() => setCardMode('carousel')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                    cardMode === 'carousel'
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Carousel ({totalSlides} Slides)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Warning if Fit in 1 Card cannot safely fit */}
        {cardMode === 'fit' && !pagination.canFitSingle && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              This confession is too long to remain readable on one card. Use Carousel.
            </span>
          </div>
        )}

        {/* Smart Growth Preparation Recommendation */}
        <SmartContentPreparation confession={confession} />

        {/* Content Preview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-4 bg-zinc-50/80 p-5 rounded-2xl border border-zinc-200/60 items-center">
          <div className="flex flex-col items-center justify-center">
            <PostCardPreview
              text={currentTextToRender}
              displayName={confession.display_name}
              isAnonymous={confession.is_anonymous}
              confessionNumber={confession.google_sheet_row}
              template={template}
              scale={0.28}
              mode={cardMode}
              slideIndex={currentSlide}
              totalSlides={cardMode === 'carousel' ? totalSlides : 1}
            />

            {/* Carousel Slide Navigation Controls */}
            {cardMode === 'carousel' && totalSlides > 1 && (
              <div className="flex items-center justify-between w-full max-w-[300px] mt-3 px-1 text-xs font-semibold text-zinc-700">
                <button
                  type="button"
                  onClick={() => setCurrentSlide((s) => Math.max(0, s - 1))}
                  disabled={currentSlide === 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <span className="text-zinc-500">
                  Slide {currentSlide + 1} of {totalSlides}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentSlide((s) => Math.min(totalSlides - 1, s + 1))}
                  disabled={currentSlide === totalSlides - 1}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Quick Download Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleDownloadCurrent}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-brand-600" />
                <span>
                  {downloading
                    ? 'Exporting...'
                    : cardMode === 'carousel' && totalSlides > 1
                    ? `Download Slide ${currentSlide + 1}`
                    : 'Download PNG'}
                </span>
              </button>
              {cardMode === 'carousel' && totalSlides > 1 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-xs font-semibold text-brand-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 text-brand-600" />
                  <span>Download All ({totalSlides})</span>
                </button>
              )}
            </div>
          </div>


          <div className="flex flex-col justify-between text-xs space-y-4">
            <div>
              <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1">
                Target Account
              </span>
              <p className="font-semibold text-zinc-900 text-sm">@campusconfessions_official</p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-48 pr-1 border border-zinc-200/80 rounded-xl p-3 bg-white">
              <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] block mb-1.5">
                Instagram Caption
              </span>
              <p className="text-zinc-700 whitespace-pre-wrap leading-relaxed text-xs">
                {previewCaption}
              </p>
            </div>

            <div className="pt-2 border-t border-zinc-200 flex items-center justify-between">
              <div>
                <span className="text-zinc-500 font-medium">Schedule:</span>{' '}
                <span className="font-bold text-emerald-700">Immediate Publish</span>
              </div>
              <div className="text-[11px] text-zinc-500">
                {cardMode === 'fit' && '📸 Single 1080×1350 Post (4:5)'}
                {cardMode === 'hook' && '📖 Hook + Full Caption'}
                {cardMode === 'carousel' && `📑 ${totalSlides}-Slide Carousel`}
              </div>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isSuccess && (
          <div className="mb-4 flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>Published successfully!</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-100">
          <button
            type="button"
            onClick={handleDownloadCurrent}
            disabled={publishing || downloading}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-sm font-semibold text-zinc-800 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            title="Download this 1080x1080 card as PNG"
          >
            <Download className="w-4 h-4 text-zinc-600" />
            <span>{downloading ? 'Exporting...' : 'Download Post (PNG)'}</span>
          </button>

          <div className="flex items-center gap-3">
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
  </div>
  );
}
