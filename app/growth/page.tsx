'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  BarChart3,
  Clock,
  Sparkles,
  Layers,
  FlaskConical,
  Search,
  Download,
  AlertCircle,
  CheckCircle2,
  Video,
  Play,
  RotateCcw,
  Flame,
  HelpCircle,
  ArrowUpRight,
  ShieldCheck,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useToast } from '@/components/ui/ToastContext';
import {
  AccountGrowthOverview,
  FormatComparisonStats,
  TimeSlotStats,
  PostGapStats,
  CategoryGrowthStats,
  HookPerformanceStats,
  PostGrowthAnalysis,
  PostingExperiment,
} from '@/types/growth';

type GrowthTab = 'overview' | 'formats' | 'timing' | 'content' | 'experiments' | 'diagnostics';

export default function GrowthIntelligencePage() {
  const [activeTab, setActiveTab] = useState<GrowthTab>('overview');
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<Record<string, any>>({});
  
  // Data states
  const [overview, setOverview] = useState<AccountGrowthOverview | null>(null);
  const [formats, setFormats] = useState<FormatComparisonStats[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotStats[]>([]);
  const [gaps, setGaps] = useState<PostGapStats[]>([]);
  const [categories, setCategories] = useState<CategoryGrowthStats[]>([]);
  const [hooks, setHooks] = useState<HookPerformanceStats[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [postDiagnostics, setPostDiagnostics] = useState<PostGrowthAnalysis | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [experiments, setExperiments] = useState<PostingExperiment[]>([]);

  // Reel modal state
  const [isReelModalOpen, setIsReelModalOpen] = useState(false);
  const [reelConfessionId, setReelConfessionId] = useState('');
  const [reelAnimation, setReelAnimation] = useState('FADE');
  const [reelHook, setReelHook] = useState('I DID NOT EXPECT THIS FROM MY CRUSH...');
  const [renderingReel, setRenderingReel] = useState(false);

  // Experiment modal state
  const [isExpModalOpen, setIsExpModalOpen] = useState(false);
  const [expName, setExpName] = useState('');
  const [expHypothesis, setExpHypothesis] = useState('');
  const [expFactor, setExpFactor] = useState('CONTENT_FORMAT');
  const [expVariantA, setExpVariantA] = useState('Static Graphic Card');
  const [expVariantB, setExpVariantB] = useState('Animated 9:16 Reel');

  const { success, error } = useToast();

  const loadAllGrowthData = useCallback(async () => {
    try {
      setLoading(true);
      const [ovRes, fmtRes, timeRes, gapRes, catRes, hookRes, postRes, expRes, anaRes] = await Promise.all([
        fetch('/api/growth/overview'),
        fetch('/api/growth/formats'),
        fetch('/api/growth/times'),
        fetch('/api/growth/gaps'),
        fetch('/api/growth/categories'),
        fetch('/api/growth/hooks'),
        fetch('/api/growth/posts'),
        fetch('/api/growth/experiments'),
        fetch('/api/growth/analysis'),
      ]);

      const [ovData, fmtData, timeData, gapData, catData, hookData, postData, expData, anaData] = await Promise.all([
        ovRes.json(),
        fmtRes.json(),
        timeRes.json(),
        gapRes.json(),
        catRes.json(),
        hookRes.json(),
        postRes.json(),
        expRes.json(),
        anaRes.json(),
      ]);

      if (ovData.success) {
        setOverview(ovData.data);
        setFlags(ovData.flags || {});
      }
      if (fmtData.success) setFormats(fmtData.data || []);
      if (timeData.success) setTimeSlots(timeData.data || []);
      if (gapData.success) setGaps(gapData.data || []);
      if (catData.success) setCategories(catData.data || []);
      if (hookData.success) setHooks(hookData.data || []);
      if (postData.success) {
        setPosts(postData.data || []);
        if (postData.data?.length > 0 && !selectedPostId) {
          setSelectedPostId(postData.data[0].id);
        }
      }
      if (expData.success) setExperiments(expData.data || []);
      if (anaData.success) setAnalysis(anaData.data || null);
    } catch (err: any) {
      console.error('Error loading growth data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPostId]);

  useEffect(() => {
    loadAllGrowthData();
  }, [loadAllGrowthData]);

  // Load post diagnostics whenever selectedPostId changes
  useEffect(() => {
    if (!selectedPostId) return;
    const fetchDiagnostics = async () => {
      try {
        const res = await fetch(`/api/growth/posts/${selectedPostId}`);
        const data = await res.json();
        if (data.success) {
          setPostDiagnostics(data.data);
        }
      } catch (err) {
        console.error('Error loading post diagnostics:', err);
      }
    };
    fetchDiagnostics();
  }, [selectedPostId]);

  const handleBackfill = async () => {
    try {
      const res = await fetch('/api/growth/posts?backfill=true');
      const data = await res.json();
      if (data.success) {
        success('Historical published posts synced into Growth Intelligence.');
        loadAllGrowthData();
      }
    } catch {
      error('Failed to backfill historical posts.');
    }
  };

  const handleGenerateReel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reelConfessionId) {
      error('Please select a confession.');
      return;
    }
    setRenderingReel(true);
    try {
      const res = await fetch('/api/growth/reels/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confessionId: reelConfessionId,
          animationStyle: reelAnimation,
          hookText: reelHook,
        }),
      });
      const data = await res.json();
      if (data.success) {
        success(`Reel Variant #${data.data.variant_name} compiled successfully!`);
        setIsReelModalOpen(false);
        loadAllGrowthData();
      } else {
        error(data.error || 'Failed to generate reel');
      }
    } catch {
      error('Reel generation network error.');
    } finally {
      setRenderingReel(false);
    }
  };

  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/growth/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: expName,
          hypothesis: expHypothesis,
          factor: expFactor,
          variants: [
            { id: 'var-a', name: expVariantA, description: 'Baseline control', config: {} },
            { id: 'var-b', name: expVariantB, description: 'Experimental test variant', config: {} },
          ],
        }),
      });
      const data = await res.json();
      if (data.success) {
        success('Controlled experiment registered successfully!');
        setIsExpModalOpen(false);
        setExpName('');
        setExpHypothesis('');
        loadAllGrowthData();
      } else {
        error(data.error || 'Failed to create experiment.');
      }
    } catch {
      error('Experiment creation failed.');
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto pb-16">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Growth Intelligence</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                v2.4
              </span>
            </div>
            <p className="text-sm text-zinc-500 mt-1">
              Empirical social analytics, controlled trials, and Groq-powered content optimization.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleBackfill}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 shadow-sm transition-all"
              title="Import historical posts from internal logs into Growth Intelligence"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Sync History
            </button>

            <a
              href="/api/growth/export?format=csv"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 shadow-sm transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </a>

            <button
              onClick={() => setIsReelModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-rose-500 to-indigo-600 rounded-xl hover:opacity-95 shadow-sm transition-all"
            >
              <Video className="w-3.5 h-3.5" />
              Render Reel Variant
            </button>
          </div>
        </div>

        {/* Feature Flags Notice Banner */}
        {(!flags.analyticsCollection || !flags.growthIntelligence) && (
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-semibold text-amber-950">Growth Intelligence is in Observational Baseline Mode</p>
              <p className="text-amber-800">
                Automatic scheduled analytics polling is guarded by feature flags (<code className="px-1.5 py-0.5 bg-amber-100/80 rounded font-mono text-[11px]">ENABLE_ANALYTICS_COLLECTION=false</code>). Existing Instagram publishing and Google Sheets syncing continue with 100% normal behavior.
              </p>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-zinc-200 overflow-x-auto pb-1 text-sm font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'overview'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Overview & AI Analyst
          </button>

          <button
            onClick={() => setActiveTab('formats')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'formats'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Layers className="w-4 h-4" />
            Format & Reel Studio
          </button>

          <button
            onClick={() => setActiveTab('timing')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'timing'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Clock className="w-4 h-4" />
            Time & Post Gaps
          </button>

          <button
            onClick={() => setActiveTab('content')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'content'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Categories & Hooks
          </button>

          <button
            onClick={() => setActiveTab('experiments')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'experiments'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            Controlled Trials
          </button>

          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'diagnostics'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Flame className="w-4 h-4" />
            Post Diagnostics
          </button>
        </div>

        {/* ================= TAB 1: OVERVIEW & GROQ ANALYST ================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top KPI Grid (Mean & Median explicitly separated) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Median Reach
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-900">
                    {overview?.median_reach?.toLocaleString() ?? 0}
                  </span>
                  <span className="text-xs text-zinc-500">
                    (Mean: {overview?.mean_reach?.toLocaleString() ?? 0})
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  Accounts reached per post (median guards against viral distortion).
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Median Views / Plays
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-900">
                    {overview?.median_views?.toLocaleString() ?? 0}
                  </span>
                  <span className="text-xs text-zinc-500">
                    (Mean: {overview?.mean_views?.toLocaleString() ?? 0})
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  Total impressions across feed and discover surfaces.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Avg Engagement Rate
                </span>
                <div className="text-2xl font-bold text-emerald-600">
                  {overview?.average_engagement_rate ?? 0}%
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  (Shares + Saves + Comments) ÷ Reach across observed sample.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Posts Tracked
                </span>
                <div className="text-2xl font-bold text-indigo-600">
                  {overview?.total_published ?? 0}
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  {overview?.posts_last_30_days ?? 0} published in last 30 days.
                </p>
              </div>
            </div>

            {/* ConfessionFlow Performance Index Explainer */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-zinc-900 to-indigo-950 text-white shadow-md">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 mb-2">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Internal Quality Index
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">ConfessionFlow Performance Index</h3>
                  <p className="text-xs text-zinc-300 mt-1 max-w-2xl leading-relaxed">
                    A normalized benchmark score (0–100) calculated from your account&apos;s observed history.
                    Weights: Reach (30%), Shares (25%), Saves (20%), Comments (10%), Profile Visits (10%), Follows (5%).
                    <strong> NOT an official Instagram algorithm metric.</strong>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs text-zinc-400 block uppercase">Formula Status</span>
                  <span className="text-sm font-bold text-emerald-400">Calibrated (100-pt Scale)</span>
                </div>
              </div>
            </div>

            {/* Groq Macro Growth Analysis Card */}
            {analysis && (
              <div className="p-6 rounded-2xl bg-white border border-zinc-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-bold text-zinc-900">Groq AI Quantitative Growth Intelligence</h3>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Llama-3.3-70B Empirical Reasoning
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100 space-y-2">
                    <strong className="text-zinc-900 block font-semibold">Observed Empirical Facts:</strong>
                    <ul className="space-y-1.5 list-disc list-inside text-zinc-600">
                      {analysis.observations?.map((obs: string, i: number) => (
                        <li key={i}>{obs}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100 space-y-2">
                    <strong className="text-zinc-900 block font-semibold">Testing-Oriented Recommendations:</strong>
                    <ul className="space-y-1.5 list-disc list-inside text-zinc-600">
                      {analysis.recommendations?.map((rec: string, i: number) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100 text-[11px] text-amber-800">
                  <strong>Statistical Confidence Caveat:</strong> {analysis.confidence?.join(' ')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: FORMATS & REEL STUDIO ================= */}
        {activeTab === 'formats' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-zinc-900 text-base">Format Performance Comparison</h3>
                  <p className="text-xs text-zinc-500">
                    Compare static cards vs animated reels. Conclusions require N &ge; 10 samples before asserting reliability.
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-lg">
                  N &ge; 20 = Statistical Support
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500">
                      <th className="py-2.5 font-semibold">Format</th>
                      <th className="py-2.5 font-semibold">Sample Size</th>
                      <th className="py-2.5 font-semibold">Median Reach</th>
                      <th className="py-2.5 font-semibold">Mean Reach</th>
                      <th className="py-2.5 font-semibold">Median Views</th>
                      <th className="py-2.5 font-semibold">Share Rate</th>
                      <th className="py-2.5 font-semibold">Confidence State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {formats.map((fmt) => (
                      <tr key={fmt.format_type} className="hover:bg-zinc-50/50">
                        <td className="py-3 font-bold text-zinc-900 flex items-center gap-2">
                          {fmt.format_type === 'REEL' ? (
                            <Video className="w-4 h-4 text-rose-500" />
                          ) : (
                            <Layers className="w-4 h-4 text-indigo-500" />
                          )}
                          {fmt.format_type}
                        </td>
                        <td className="py-3 text-zinc-700 font-mono">N={fmt.sample_size}</td>
                        <td className="py-3 font-bold text-zinc-900">{fmt.median_reach?.toLocaleString() ?? 0}</td>
                        <td className="py-3 text-zinc-600">{fmt.mean_reach?.toLocaleString() ?? 0}</td>
                        <td className="py-3 text-zinc-700">{fmt.median_views?.toLocaleString() ?? 0}</td>
                        <td className="py-3 text-emerald-600 font-medium">{fmt.share_rate}%</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              fmt.support_state === 'SUPPORTED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : fmt.support_state === 'PROMISING'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : fmt.support_state === 'PRELIMINARY'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {fmt.support_state.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Reel Studio Banner */}
            <div className="p-6 rounded-2xl bg-gradient-to-r from-rose-50 via-white to-indigo-50 border border-rose-200/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-1">
                <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full font-bold text-[10px] uppercase">
                  9:16 Video Engine
                </span>
                <h4 className="text-base font-bold text-zinc-900">Interactive Reel Variant Studio</h4>
                <p className="text-xs text-zinc-600 max-w-xl">
                  Transform any confession into an animated 1080×1920 Instagram Reel with timed hooks (0–1.5s), body reveal (1.5–7s), and call-to-action payoff. The original static card remains 100% available.
                </p>
              </div>
              <button
                onClick={() => setIsReelModalOpen(true)}
                className="px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-semibold hover:bg-zinc-800 transition-all shrink-0 shadow-sm"
              >
                Open Reel Builder
              </button>
            </div>
          </div>
        )}

        {/* ================= TAB 3: TIMING & GAPS ================= */}
        {activeTab === 'timing' && (
          <div className="space-y-6">
            {/* Post Gap Analysis */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="font-bold text-zinc-900 text-base">Publication Interval (Gap) Analysis</h3>
                  <p className="text-xs text-zinc-500">
                    Performance evaluated against spacing from the previous post.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                  ⚠️ Correlation observed, not causal evidence.
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {gaps.map((g) => (
                  <div key={g.gap_bucket} className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/80 text-center">
                    <span className="text-xs font-bold text-zinc-700 block mb-1 font-mono">{g.gap_bucket}</span>
                    <span className="text-lg font-bold text-zinc-900 block">{g.median_reach?.toLocaleString() ?? 0}</span>
                    <span className="text-[10px] text-zinc-600 block mt-0.5">Median Reach</span>
                    <div className="mt-2 text-[10px] text-zinc-600">Sample: N={g.sample_size}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Time Slot Analysis Table */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
              <h3 className="font-bold text-zinc-900 text-base mb-1">Time Performance Distribution</h3>
              <p className="text-xs text-zinc-500 mb-4">
                Median reach by local hour of day. Requires sufficient observations per slot before asserting optimal windows.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500">
                      <th className="py-2.5 font-semibold">Hour of Day</th>
                      <th className="py-2.5 font-semibold">Sample (N)</th>
                      <th className="py-2.5 font-semibold">Median Reach</th>
                      <th className="py-2.5 font-semibold">Mean Reach</th>
                      <th className="py-2.5 font-semibold">Median Views</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {timeSlots.slice(0, 10).map((ts) => (
                      <tr key={`${ts.day_of_week}-${ts.hour_of_day}`} className="hover:bg-zinc-50/50">
                        <td className="py-2.5 font-mono font-medium text-zinc-900">
                          {ts.hour_of_day % 12 || 12}:00 {ts.hour_of_day >= 12 ? 'PM' : 'AM'}
                        </td>
                        <td className="py-2.5 text-zinc-600">N={ts.sample_size}</td>
                        <td className="py-2.5 font-bold text-zinc-900">{ts.median_reach?.toLocaleString() ?? 0}</td>
                        <td className="py-2.5 text-zinc-600">{ts.mean_reach?.toLocaleString() ?? 0}</td>
                        <td className="py-2.5 text-zinc-700">{ts.median_views?.toLocaleString() ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 4: CATEGORIES & HOOKS ================= */}
        {activeTab === 'content' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Category Breakdown */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
                <h3 className="font-bold text-zinc-900 text-base mb-1">Content Category Breakdown</h3>
                <p className="text-xs text-zinc-500 mb-4">Relative performance across thematic clusters.</p>

                <div className="space-y-3">
                  {categories.map((cat) => (
                    <div key={cat.category} className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-between text-xs">
                      <div>
                        <strong className="text-zinc-900 font-bold block">{cat.category}</strong>
                        <span className="text-[11px] text-zinc-500">N={cat.post_count} posts • {cat.share_rate}% share rate</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-zinc-900 text-sm">{cat.median_reach?.toLocaleString() ?? 0}</span>
                        <span className="text-[10px] text-zinc-600 block">Median Reach</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hook Performance */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
                <h3 className="font-bold text-zinc-900 text-base mb-1">Opening Hook Performance</h3>
                <p className="text-xs text-zinc-500 mb-4">Linguistic analysis of the first sentence structure.</p>

                <div className="space-y-3">
                  {hooks.map((h) => (
                    <div key={h.hook_type} className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-between text-xs">
                      <div>
                        <strong className="text-zinc-900 font-bold block">{h.hook_type.replace('_', ' ')}</strong>
                        <span className="text-[11px] text-zinc-500">Sample: N={h.sample_size} • {h.share_rate}% share rate</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-zinc-900 text-sm">{h.median_reach?.toLocaleString() ?? 0}</span>
                        <span className="text-[10px] text-zinc-600 block">Median Reach</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 5: CONTROLLED TRIALS ================= */}
        {activeTab === 'experiments' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-zinc-900 text-base">Controlled Trials & A/B Experiments</h3>
                <p className="text-xs text-zinc-500">
                  Explicit variant assignment with confounder control. Never conflates passive correlations with experimental proof.
                </p>
              </div>
              <button
                onClick={() => setIsExpModalOpen(true)}
                className="px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-all shadow-sm"
              >
                + New Experiment
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {experiments.map((exp) => (
                <div key={exp.id} className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">
                        Factor: {exp.factor.replace('_', ' ')}
                      </span>
                      <h4 className="font-bold text-zinc-900 text-sm mt-0.5">{exp.name}</h4>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-700">
                      {exp.confidence_status.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 italic bg-zinc-50 p-2.5 rounded-lg border border-zinc-100">
                    &ldquo;{exp.hypothesis}&rdquo;
                  </p>

                  <div className="space-y-1.5 text-xs">
                    <div className="text-[11px] font-semibold text-zinc-500 uppercase">Test Variants:</div>
                    {exp.variants?.map((v) => (
                      <div key={v.id} className="flex justify-between items-center text-zinc-700 bg-white p-2 rounded-lg border border-zinc-100">
                        <span className="font-medium">{v.name}</span>
                        <span className="text-[10px] text-zinc-600">{v.description}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-zinc-100 pt-2 flex justify-between items-center text-xs text-zinc-500">
                    <span>Sample Size: N={exp.sample_size}</span>
                    <span className="font-medium text-indigo-600">Active Balanced Assignment</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= TAB 6: POST DIAGNOSTICS ================= */}
        {activeTab === 'diagnostics' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Posts List Column */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm space-y-2 h-[700px] overflow-y-auto">
              <h4 className="font-bold text-zinc-900 text-xs uppercase tracking-wider px-2 py-1">
                Published Posts ({posts.length})
              </h4>
              {posts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPostId(p.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedPostId === p.id
                      ? 'bg-indigo-50/70 border-indigo-300 shadow-sm'
                      : 'bg-white border-zinc-100 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-xs text-zinc-900">Post #{p.confession_number || '•'}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">
                      Score: {p.performance_index}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-600 line-clamp-2 mt-1">{p.preview_text}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-500">
                    <span>{p.format_type}</span>
                    <span>•</span>
                    <span>Reach: {p.metrics?.reach ?? 'N/A'}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Post Diagnostics & Performance Curve Column */}
            <div className="lg:col-span-2 space-y-6">
              {postDiagnostics ? (
                <>
                  <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-4">
                      <div>
                        <span className="text-xs font-bold text-indigo-600 uppercase">
                          Confession #{postDiagnostics.confession_number} Diagnostics
                        </span>
                        <h3 className="font-bold text-zinc-900 text-base mt-0.5">
                          {postDiagnostics.preview_text}
                        </h3>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-zinc-500 block">Performance Index</span>
                        <span className="text-2xl font-bold text-indigo-600">{postDiagnostics.performance_index} / 100</span>
                        <span className="text-[10px] text-zinc-500 block">Percentile: {postDiagnostics.percentile_in_sample}th</span>
                      </div>
                    </div>

                    {/* Performance Curve Table */}
                    <div>
                      <h4 className="font-semibold text-xs text-zinc-900 mb-2">Growth Curve & Velocity:</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-zinc-200 text-zinc-500">
                              <th className="py-2">Milestone</th>
                              <th className="py-2">Actual Age</th>
                              <th className="py-2">Views</th>
                              <th className="py-2">Reach</th>
                              <th className="py-2">Shares</th>
                              <th className="py-2">Velocity (views/hr)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {postDiagnostics.curve?.map((pt) => (
                              <tr key={pt.age_bucket}>
                                <td className="py-2 font-mono font-bold text-zinc-800">{pt.age_bucket}</td>
                                <td className="py-2 text-zinc-600">{pt.actual_age_minutes}m</td>
                                <td className="py-2 font-medium">{pt.cumulative_views}</td>
                                <td className="py-2 text-zinc-700">{pt.cumulative_reach}</td>
                                <td className="py-2 text-zinc-700">{pt.cumulative_shares}</td>
                                <td className="py-2 font-mono font-semibold text-indigo-600">{pt.velocity_views_per_hour}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* AI Post-Mortem */}
                  {postDiagnostics.ai_post_mortem && (
                    <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-3">
                      <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                        <h4 className="font-bold text-zinc-900 text-sm flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          Empirical Post-Mortem Analysis
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-700">
                          Confidence: {postDiagnostics.ai_post_mortem.confidence}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100 space-y-1">
                          <strong className="text-zinc-900 font-semibold block">Observed Measured Facts:</strong>
                          <ul className="list-disc list-inside space-y-1 text-zinc-600">
                            {postDiagnostics.ai_post_mortem.observed_facts?.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100 space-y-1">
                          <strong className="text-zinc-900 font-semibold block">Possible Explanations:</strong>
                          <ul className="list-disc list-inside space-y-1 text-zinc-600">
                            {postDiagnostics.ai_post_mortem.possible_explanations?.map((exp, i) => (
                              <li key={i}>{exp}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {postDiagnostics.ai_post_mortem.unsupported_hypotheses?.length > 0 && (
                        <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-100 text-[11px] text-rose-800">
                          <strong>Unsupported Hypotheses (Guarded):</strong>{' '}
                          {postDiagnostics.ai_post_mortem.unsupported_hypotheses.join(' • ')}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="p-12 text-center text-zinc-500 bg-white rounded-2xl border border-zinc-200">
                  Select a post from the left column to view its performance curve and post-mortem.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= MODAL: RENDER REEL VARIANT ================= */}
        {isReelModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-zinc-200 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-rose-500" />
                  <h3 className="font-bold text-zinc-900 text-base">Generate 9:16 Reel Variant</h3>
                </div>
                <button onClick={() => setIsReelModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                  ✕
                </button>
              </div>

              <form onSubmit={handleGenerateReel} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Target Confession</label>
                  <select
                    value={reelConfessionId}
                    onChange={(e) => setReelConfessionId(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  >
                    <option value="">Select confession...</option>
                    {posts.map((p) => (
                      <option key={p.content_id} value={p.content_id}>
                        #{p.confession_number || '•'} - {p.preview_text.slice(0, 50)}...
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Opening Hook Style (0–1.5s)</label>
                  <input
                    type="text"
                    value={reelHook}
                    onChange={(e) => setReelHook(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. I DID NOT EXPECT THIS..."
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Animation Transition</label>
                  <select
                    value={reelAnimation}
                    onChange={(e) => setReelAnimation(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="FADE">Smooth Fade (Recommended)</option>
                    <option value="SLIDE">Vertical Slide Reveal</option>
                    <option value="ZOOM">Kinetic Zoom In</option>
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100 text-[11px] text-zinc-600">
                  <strong>Audio Policy:</strong> Renders with royalty-free/platform native audio configuration. Does not embed copyrighted music, fully respecting platform licensing constraints.
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsReelModalOpen(false)}
                    className="px-4 py-2 border border-zinc-200 rounded-xl font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renderingReel}
                    className="px-4 py-2 bg-gradient-to-r from-rose-500 to-indigo-600 text-white rounded-xl font-semibold hover:opacity-95 disabled:opacity-50"
                  >
                    {renderingReel ? 'Compiling Reel...' : 'Render 1080×1920 Reel'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================= MODAL: CREATE EXPERIMENT ================= */}
        {isExpModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-zinc-200 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-zinc-900 text-base">New Controlled Experiment</h3>
                </div>
                <button onClick={() => setIsExpModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateExperiment} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Experiment Name</label>
                  <input
                    type="text"
                    value={expName}
                    onChange={(e) => setExpName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Image vs Reel Engagement Trial"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Testable Hypothesis</label>
                  <input
                    type="text"
                    value={expHypothesis}
                    onChange={(e) => setExpHypothesis(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. 9:16 Video Reels will produce higher median reach than static image cards."
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Testing Factor</label>
                  <select
                    value={expFactor}
                    onChange={(e) => setExpFactor(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="CONTENT_FORMAT">Content Format (Image vs Reel)</option>
                    <option value="HOOK_STYLE">Opening Hook Style</option>
                    <option value="POST_GAP">Post Gap Intervals</option>
                    <option value="POSTING_TIME">Posting Time Windows</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">Variant A (Control)</label>
                    <input
                      type="text"
                      value={expVariantA}
                      onChange={(e) => setExpVariantA(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-zinc-700 block mb-1">Variant B (Test)</label>
                    <input
                      type="text"
                      value={expVariantB}
                      onChange={(e) => setExpVariantB(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-xl"
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsExpModalOpen(false)}
                    className="px-4 py-2 border border-zinc-200 rounded-xl font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700"
                  >
                    Launch Controlled Trial
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
