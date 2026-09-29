'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  TrendingUp,
  Clock,
  Video,
  Image as ImageIcon,
  Check,
  X,
  Shuffle,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { Confession } from '@/types';
import { GrowthRecommendation, MediaFormatType } from '@/types/growth';
import { useToast } from '@/components/ui/ToastContext';

interface SmartContentPreparationProps {
  confession: Confession;
  onApplyFormat?: (format: MediaFormatType) => void;
  onApplySchedule?: (scheduledTime: string) => void;
  onDismiss?: () => void;
  defaultExpanded?: boolean;
}

export function SmartContentPreparation({
  confession,
  onApplyFormat,
  onApplySchedule,
  onDismiss,
  defaultExpanded = false,
}: SmartContentPreparationProps) {
  const [recommendation, setRecommendation] = useState<GrowthRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionTaken, setActionTaken] = useState<'ACCEPTED' | 'OVERRIDDEN' | 'DISMISSED' | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [processingAction, setProcessingAction] = useState(false);
  const { success, error } = useToast();

  useEffect(() => {
    let isMounted = true;
    async function fetchRecommendation() {
      try {
        setLoading(true);
        const res = await fetch(`/api/growth/recommendations?contentId=${encodeURIComponent(confession.id)}`);
        const json = await res.json();
        if (isMounted && json.success && json.data && json.data.length > 0) {
          setRecommendation(json.data[0]);
        }
      } catch {
        // Fallback silently if growth service is inactive
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchRecommendation();
    return () => {
      isMounted = false;
    };
  }, [confession.id]);

  const sendFeedback = async (action: 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'OVERRIDDEN', notes?: string) => {
    if (!recommendation) return;
    try {
      await fetch(`/api/growth/recommendations/${recommendation.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback_notes: notes }),
      });
    } catch {
      // non-blocking feedback logging
    }
  };

  const handleAccept = async () => {
    if (!recommendation) return;
    setProcessingAction(true);
    try {
      await sendFeedback('ACCEPTED', `Accepted format ${recommendation.recommended_format} and timing ${recommendation.recommended_time}`);
      setActionTaken('ACCEPTED');
      success(`Applied ${recommendation.recommended_format} format and optimal timing!`);
      if (onApplyFormat) onApplyFormat(recommendation.recommended_format);
      if (onApplySchedule) onApplySchedule(recommendation.recommended_time);
    } catch {
      error('Failed to apply recommendation');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleOverride = async () => {
    if (!recommendation) return;
    setProcessingAction(true);
    try {
      const altFormat = recommendation.recommended_format === 'REEL' ? 'IMAGE' : 'REEL';
      await sendFeedback('OVERRIDDEN', `Overrode to ${altFormat}`);
      setActionTaken('OVERRIDDEN');
      success(`Overridden to ${altFormat} format`);
      if (onApplyFormat) onApplyFormat(altFormat);
    } catch {
      error('Failed to override recommendation');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleDismiss = async () => {
    if (!recommendation) return;
    await sendFeedback('IGNORED', 'Dismissed by admin');
    setActionTaken('DISMISSED');
    setExpanded(false);
    if (onDismiss) onDismiss();
  };

  if (actionTaken === 'DISMISSED') return null;

  return (
    <div className="my-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-white p-3.5 shadow-xs transition-all">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left cursor-pointer group"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs group-hover:bg-indigo-700 transition-colors">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-900 group-hover:text-indigo-600 transition-colors">
                Growth Intelligence Advisor
              </span>
              {loading && <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />}
              {recommendation && !loading && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    recommendation.recommendation_confidence === 'HIGH'
                      ? 'bg-emerald-100 text-emerald-800'
                      : recommendation.recommendation_confidence === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {recommendation.recommendation_confidence} Confidence
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500">
              {recommendation
                ? `Recommended: ${recommendation.recommended_format} at ${recommendation.recommended_time} (N=${recommendation.evidence_count} evidence)`
                : 'Analyzing confession patterns and audience engagement...'}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1">
          {actionTaken === 'ACCEPTED' && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              <Check className="h-3 w-3" /> Accepted
            </span>
          )}
          {actionTaken === 'OVERRIDDEN' && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
              <Shuffle className="h-3 w-3" /> Overridden
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-zinc-400 hover:text-zinc-600 rounded-md cursor-pointer"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && recommendation && (
        <div className="mt-3.5 space-y-3 pt-3 border-t border-indigo-100/70 text-xs">
          {/* Key Recommendations Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* 1. Format */}
            <div className="p-2.5 rounded-xl bg-white border border-indigo-100/80 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                <span>Recommended Format</span>
                {recommendation.recommended_format === 'REEL' ? (
                  <Video className="h-3.5 w-3.5 text-purple-600" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 text-indigo-600" />
                )}
              </div>
              <div className="text-sm font-bold text-zinc-900 flex items-center gap-1.5">
                <span>{recommendation.recommended_format}</span>
                <span className="text-[10px] font-normal text-zinc-400">(N={recommendation.evidence_count})</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">
                {recommendation.rationale}
              </p>
            </div>

            {/* 2. Timing Window */}
            <div className="p-2.5 rounded-xl bg-white border border-indigo-100/80 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                <span>Best Timing Window</span>
                <Clock className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div className="text-sm font-bold text-zinc-900">
                {recommendation.recommended_time}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">
                Aligned with historical peak engagement window.
              </p>
            </div>

            {/* 3. Category & Hook Style */}
            <div className="p-2.5 rounded-xl bg-white border border-indigo-100/80 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                <span>Predicted Category</span>
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <div className="text-sm font-bold text-zinc-900 truncate">
                {recommendation.recommended_category}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">
                Hook: <span className="font-semibold text-zinc-700">{recommendation.recommended_hook_style}</span>
              </p>
            </div>
          </div>

          {/* Epistemological Caveat Notice */}
          <div className="rounded-xl bg-amber-50/80 border border-amber-200/70 p-2.5 text-[11px] text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-snug">
              <span className="font-semibold">Observational Evidence:</span> Based on historical sample of N={recommendation.evidence_count} posts.
              Correlation does not guarantee future reach. Confounders: {recommendation.confounders_noted.slice(0, 2).join(', ')}.
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[11px] font-medium text-zinc-500 hover:text-zinc-700 cursor-pointer"
            >
              Dismiss
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOverride}
                disabled={processingAction}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] font-semibold text-zinc-700 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Shuffle className="h-3 w-3" />
                <span>Override with {recommendation.recommended_format === 'REEL' ? 'IMAGE' : 'REEL'}</span>
              </button>

              <button
                type="button"
                onClick={handleAccept}
                disabled={processingAction}
                className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                <span>Accept Recommendation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
