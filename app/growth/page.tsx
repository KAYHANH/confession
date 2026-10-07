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
  Activity,
  X,
  Brain,
  RefreshCw,
  CalendarCheck,
  TrendingDown,
  Gauge,
  Zap,
  PieChart,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
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
  SchedulerRecommendation,
  GrowthDecision,
  BacktestSimulationResult,
  ContentMixStrategy,
  FormatRecommendationByLength,
} from '@/types/growth';

type GrowthTab = 'overview' | 'brain' | 'simulation' | 'formats' | 'timing' | 'content' | 'experiments' | 'diagnostics';

export default function GrowthIntelligencePage() {
  const [activeTab, setActiveTab] = useState<GrowthTab>('overview');
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<Record<string, any>>({});
  
  // Growth Intelligence 3.0 Decision Engine state
  const [todayDecision, setTodayDecision] = useState<GrowthDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [isWhyPanelOpen, setIsWhyPanelOpen] = useState(true);

  // Simulation & Backtesting state
  const [simulationDays, setSimulationDays] = useState(30);
  const [simulationResult, setSimulationResult] = useState<BacktestSimulationResult | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);

  // Content Mix & Format Intelligence
  const [contentMixList, setContentMixList] = useState<ContentMixStrategy[]>([]);
  const [formatRecsList, setFormatRecsList] = useState<FormatRecommendationByLength[]>([]);

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
  const [cadenceRec, setCadenceRec] = useState<SchedulerRecommendation | null>(null);
  const [queueDiagnostics, setQueueDiagnostics] = useState<any | null>(null);

  // Account Learning & Adaptive Scheduling Brain state
  const [learningOverview, setLearningOverview] = useState<any | null>(null);
  const [brainRecommendation, setBrainRecommendation] = useState<any | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideFormat, setOverrideFormat] = useState('IMAGE');
  const [overrideTime, setOverrideTime] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

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
      const [ovRes, fmtRes, timeRes, gapRes, catRes, hookRes, postRes, expRes, anaRes, cadRes, learnRes, recRes, decRes, mixRes] = await Promise.all([
        fetch('/api/growth/overview'),
        fetch('/api/growth/formats'),
        fetch('/api/growth/times'),
        fetch('/api/growth/gaps'),
        fetch('/api/growth/categories'),
        fetch('/api/growth/hooks'),
        fetch('/api/growth/posts'),
        fetch('/api/growth/experiments'),
        fetch('/api/growth/analysis'),
        fetch('/api/growth/cadence').catch(() => null),
        fetch('/api/growth/learning/overview').catch(() => null),
        fetch('/api/growth/learning/recommendation').catch(() => null),
        fetch('/api/growth/decision').catch(() => null),
        fetch('/api/growth/content-mix').catch(() => null),
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

      if (cadRes && cadRes.ok) {
        try {
          const cData = await cadRes.json();
          if (cData.success) {
            setCadenceRec(cData.recommendation);
            setQueueDiagnostics(cData.diagnostics);
          }
        } catch {}
      }

      if (learnRes && learnRes.ok) {
        try {
          const lData = await learnRes.json();
          if (lData.success) setLearningOverview(lData.data);
        } catch {}
      }

      if (recRes && recRes.ok) {
        try {
          const rData = await recRes.json();
          if (rData.success) setBrainRecommendation(rData);
        } catch {}
      }

      if (decRes && decRes.ok) {
        try {
          const dData = await decRes.json();
          if (dData.success) setTodayDecision(dData.decision);
        } catch {}
      }

      if (mixRes && mixRes.ok) {
        try {
          const mData = await mixRes.json();
          if (mData.success) {
            setContentMixList(mData.contentMix || []);
            setFormatRecsList(mData.formatRecs || []);
          }
        } catch {}
      }

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

  const handleRefreshDecision = async () => {
    try {
      setDecisionLoading(true);
      const res = await fetch('/api/growth/decision?refresh=true');
      const data = await res.json();
      if (data.success) {
        setTodayDecision(data.decision);
        success('Growth Intelligence 3.0 decision refreshed.');
      } else {
        error(data.error || 'Failed to refresh decision.');
      }
    } catch {
      error('Failed to refresh decision.');
    } finally {
      setDecisionLoading(false);
    }
  };

  const handleRunSimulation = async (days: number = simulationDays) => {
    try {
      setSimulationLoading(true);
      setSimulationDays(days);
      const res = await fetch('/api/growth/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (data.success) {
        setSimulationResult(data.data);
      } else {
        error(data.error || 'Simulation failed.');
      }
    } catch {
      error('Failed to run simulation.');
    } finally {
      setSimulationLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'simulation' && !simulationResult && !simulationLoading) {
      handleRunSimulation(simulationDays);
    }
  }, [activeTab]);

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

  const [testingAnalytics, setTestingAnalytics] = useState(false);
  const [analyticsTestResult, setAnalyticsTestResult] = useState<any | null>(null);

  const handleTestAnalytics = async () => {
    setTestingAnalytics(true);
    setAnalyticsTestResult(null);
    try {
      const res = await fetch('/api/growth/analytics/test');
      const data = await res.json();
      setAnalyticsTestResult(data);
      if (data.success) {
        success(`Instagram Insights verified! Connected to @${data.account || '_hpsconfession_'} with active Insights.`);
      } else {
        error(data.error || 'Instagram analytics check failed');
      }
    } catch (err: any) {
      error(err?.message || 'Failed to verify analytics connection');
    } finally {
      setTestingAnalytics(false);
    }
  };

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

  const handleAcceptRecommendation = async () => {
    if (!brainRecommendation?.data?.recordId) return;
    try {
      setBrainLoading(true);
      const res = await fetch('/api/growth/learning/recommendation/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: brainRecommendation.data.recordId,
          confessionId: brainRecommendation.data.targetConfession?.id,
          scheduledTime: brainRecommendation.data.validation?.targetTimestamp,
        }),
      });
      const data = await res.json();
      if (data.success) {
        success('Recommendation accepted! Next confession scheduled successfully.');
        loadAllGrowthData();
      } else {
        error(data.error || 'Failed to accept recommendation.');
      }
    } catch {
      error('Failed to accept recommendation.');
    } finally {
      setBrainLoading(false);
    }
  };

  const handleOverrideRecommendation = async () => {
    if (!brainRecommendation?.data?.recordId) return;
    try {
      setBrainLoading(true);
      const res = await fetch('/api/growth/learning/recommendation/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: brainRecommendation.data.recordId,
          format: overrideFormat,
          scheduleTime: overrideTime || undefined,
          reason: overrideReason || 'Manual user override',
        }),
      });
      const data = await res.json();
      if (data.success) {
        success('Recommendation overridden successfully.');
        setIsOverrideModalOpen(false);
        loadAllGrowthData();
      } else {
        error(data.error || 'Failed to override recommendation.');
      }
    } catch {
      error('Failed to override recommendation.');
    } finally {
      setBrainLoading(false);
    }
  };

  const handleRefreshRecommendation = async () => {
    try {
      setBrainLoading(true);
      const res = await fetch('/api/growth/learning/recommendation', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBrainRecommendation(data);
        success('Generated fresh scheduling recommendation.');
      } else {
        error(data.error || 'Failed to refresh recommendation.');
      }
    } catch {
      error('Failed to refresh recommendation.');
    } finally {
      setBrainLoading(false);
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
              onClick={handleTestAnalytics}
              disabled={testingAnalytics}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 shadow-sm transition-all"
              title="Validate Instagram Insights permission on live media item"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-600" />
              {testingAnalytics ? 'Testing Insights...' : 'Test Analytics'}
            </button>

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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-gradient-to-r from-rose-500 to-indigo-600 rounded-xl hover:opacity-95 shadow-sm transition-all"
            >
              <Video className="w-3.5 h-3.5" />
              Render Reel Variant
            </button>
          </div>
        </div>

        {/* Analytics Test Result Banner */}
        {analyticsTestResult && (
          <div className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${
            analyticsTestResult.success
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : 'bg-rose-50/80 border-rose-200 text-rose-950'
          }`}>
            <div className="flex items-start gap-3 text-xs">
              {analyticsTestResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <span>Instagram Analytics Diagnostics:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                    analyticsTestResult.success ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    Connected: {analyticsTestResult.connected} | Insights: {analyticsTestResult.insights}
                  </span>
                </div>
                {analyticsTestResult.success ? (
                  <div className="text-emerald-800 space-y-0.5">
                    <p>Verified on media ID: <code className="font-mono bg-emerald-100/60 px-1 rounded">{analyticsTestResult.media}</code> for account <code className="font-mono bg-emerald-100/60 px-1 rounded">@{analyticsTestResult.account}</code></p>
                    <p className="font-semibold text-emerald-900">
                      Live metrics: {analyticsTestResult.views !== null ? `${analyticsTestResult.views} views` : ''} · {analyticsTestResult.reach !== null ? `${analyticsTestResult.reach} reach` : ''} · {analyticsTestResult.shares !== null ? `${analyticsTestResult.shares} shares` : ''} · {analyticsTestResult.likes !== null ? `${analyticsTestResult.likes} likes` : ''} · {analyticsTestResult.saves !== null ? `${analyticsTestResult.saves} saves` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-rose-800 font-medium">
                    {analyticsTestResult.error || 'Instagram Insights permission is missing.'}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setAnalyticsTestResult(null)}
              className="p-1 rounded-lg hover:bg-zinc-200/50 text-zinc-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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

        {/* ================= HERO CARD: TODAY'S GROWTH DECISION 3.0 ================= */}
        <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-zinc-900 to-indigo-950 text-white border border-indigo-500/30 shadow-2xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="p-2.5 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/30">
                  <Gauge className="w-6 h-6" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
                  TODAY&apos;S GROWTH DECISION
                </h2>
                {todayDecision && (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-black tracking-wide uppercase flex items-center gap-1.5 shadow-md ${
                      todayDecision.decision === 'POST_NOW'
                        ? 'bg-emerald-500 text-white animate-pulse'
                        : todayDecision.decision === 'WAIT'
                        ? 'bg-amber-500 text-slate-950'
                        : todayDecision.decision === 'SCHEDULE'
                        ? 'bg-indigo-500 text-white'
                        : todayDecision.decision === 'HOLD_CONTENT'
                        ? 'bg-rose-500 text-white'
                        : 'bg-zinc-600 text-white'
                    }`}
                  >
                    {todayDecision.decision === 'POST_NOW' && <Zap className="w-3.5 h-3.5" />}
                    {todayDecision.decision === 'WAIT' && <Clock className="w-3.5 h-3.5" />}
                    {todayDecision.decision.replace(/_/g, ' ')}
                  </span>
                )}
                {todayDecision && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-indigo-200 border border-white/10">
                    Confidence: {todayDecision.confidence} ({(todayDecision.confidence_score * 100).toFixed(0)}%)
                  </span>
                )}
                {todayDecision && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono text-purple-200 bg-purple-900/40 border border-purple-500/30">
                    {todayDecision.authority_source}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl leading-relaxed">
                Closed-loop decision engine that learns from every snapshot to dynamically govern posting cadence, spacing, and format.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              <button
                onClick={handleRefreshDecision}
                disabled={decisionLoading}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1.5 transition-all text-white border border-white/15 shadow-sm"
                title="Re-evaluate account state, real-time post velocity, and queue candidates"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${decisionLoading ? 'animate-spin' : ''}`} />
                {decisionLoading ? 'Evaluating...' : 'Re-Evaluate Decision'}
              </button>

              <button
                onClick={() => setActiveTab('simulation')}
                className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold flex items-center gap-1.5 transition-all text-white shadow-sm"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Simulate 30 Days
              </button>
            </div>
          </div>

          {/* 4 Core Pillars KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Daily Frequency */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold">
                <span>Recommended Cadence</span>
                <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-2xl font-black text-white tracking-tight">
                {todayDecision?.daily_strategy.effective_daily_posts ?? 7}{' '}
                <span className="text-sm font-normal text-zinc-300">posts / 24h</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-tight">
                {todayDecision?.daily_strategy.saturation_detected
                  ? `Knee point detected at ~${todayDecision.daily_strategy.knee_point} posts/day`
                  : `Empirical peak reach balance vs hard cap`}
              </p>
            </div>

            {/* 2. Spacing / Gap */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold">
                <span>Learned Spacing Range</span>
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-2xl font-black text-white font-mono tracking-tight">
                {todayDecision ? `${todayDecision.daily_strategy.min_gap_minutes}–${todayDecision.daily_strategy.max_gap_minutes}m` : '90–150m'}
              </div>
              <p className="text-[11px] text-zinc-400 leading-tight">
                Effective interval: {todayDecision?.recommended_gap_minutes ?? 90}m (protects retention)
              </p>
            </div>

            {/* 3. Next Candidate & Format */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold">
                <span>Next Selected Post</span>
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-xl font-black text-white flex items-center gap-2">
                <span>#{todayDecision?.candidate_row ?? todayDecision?.candidate?.google_sheet_row ?? 'Queue'}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                  {todayDecision?.recommended_format ?? 'IMAGE'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-tight">
                Quality: {todayDecision?.candidate?.predicted_performance_score ?? 'Qualified'}/100 score
              </p>
            </div>

            {/* 4. Active Post Velocity & Viral Guard */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold">
                <span>Active Post Velocity</span>
                <Flame className={`w-3.5 h-3.5 ${todayDecision?.current_post_status?.is_accelerating ? 'text-amber-400 animate-pulse' : 'text-zinc-500'}`} />
              </div>
              <div className="text-xl font-black text-white flex items-center gap-2">
                <span>{todayDecision?.current_post_status?.views_velocity_per_hour ?? 0} v/hr</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                  (todayDecision?.current_post_status?.historical_percentile ?? 50) >= 85
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-400/30'
                    : 'bg-zinc-800 text-zinc-300'
                }`}>
                  {todayDecision?.current_post_status?.historical_percentile ?? 50}th %tile
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-tight truncate">
                {todayDecision?.current_post_status?.is_accelerating
                  ? '🔥 Outperforming historical baseline'
                  : 'Cadence pacing is clear'}
              </p>
            </div>
          </div>

          {/* Transparent "WHY" Section */}
          <div className="rounded-2xl bg-black/30 border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="font-bold text-sm tracking-wide uppercase text-indigo-200">
                  Decision Rationale &amp; Empirical Evidence (&ldquo;WHY&rdquo;)
                </h3>
              </div>
              <button
                onClick={() => setIsWhyPanelOpen(!isWhyPanelOpen)}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                {isWhyPanelOpen ? 'Collapse Rationale' : 'Expand Rationale'}
                {isWhyPanelOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Summary Sentence */}
            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs sm:text-sm text-indigo-100 font-medium leading-relaxed">
              {todayDecision?.rationale.summary || 'Growth Intelligence is continuously observing post reach snapshots and calculating optimal cadence boundaries.'}
            </div>

            {/* 7 Factors Grid */}
            {isWhyPanelOpen && todayDecision?.rationale.factors && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 text-xs">
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>1. Frequency Intelligence</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">{todayDecision.rationale.factors.frequency}</p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>2. Real-Time Post Velocity</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">{todayDecision.rationale.factors.real_time_velocity}</p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>3. Gap &amp; Spacing Intelligence</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">{todayDecision.rationale.factors.gap}</p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>4. Format by Length</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">{todayDecision.rationale.factors.format}</p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>5. Content Mix &amp; Category Efficiency</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">{todayDecision.rationale.factors.content_mix}</p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>6. Quality Gate &amp; Timing</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">
                    {todayDecision.rationale.factors.content_quality} · {todayDecision.rationale.factors.timing}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

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
            onClick={() => setActiveTab('brain')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'brain'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <Brain className="w-4 h-4 text-indigo-300" />
            Adaptive Scheduling Brain
          </button>

          <button
            onClick={() => setActiveTab('simulation')}
            className={`px-4 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === 'simulation'
                ? 'bg-purple-700 text-white shadow-sm font-semibold'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4 text-purple-300" />
            Simulation & Backtesting
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
            {/* Real-time Adaptive Scheduling Brain Card */}
            {brainRecommendation?.data && (
              <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950 via-slate-900 to-zinc-950 text-white shadow-xl border border-indigo-500/20 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-900/60 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      <Brain className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold tracking-tight">Adaptive Scheduling Brain</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                          brainRecommendation.data.validation?.status === 'VALIDATED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {brainRecommendation.data.validation?.status || 'VALIDATED'}
                        </span>
                      </div>
                      <p className="text-xs text-indigo-200/70 mt-0.5">
                        Closed learning loop powered by Llama-3.3-70B with deterministic platform safety validation.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRefreshRecommendation}
                      disabled={brainLoading}
                      className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1.5 transition-all text-white border border-white/10"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${brainLoading ? 'animate-spin' : ''}`} />
                      Refresh Recommendation
                    </button>
                  </div>
                </div>

                {/* Key Recommendation Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-zinc-400 block text-[11px] uppercase font-semibold">Recommended Format</span>
                    <span className="text-base font-bold text-indigo-300 mt-1 block">
                      {brainRecommendation.data.validation?.targetFormat || brainRecommendation.data.recommendation?.recommended_format}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      Alt: {brainRecommendation.data.recommendation?.alternative?.format || 'CAROUSEL'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-zinc-400 block text-[11px] uppercase font-semibold">Validated Next Publish</span>
                    <span className="text-sm font-bold text-emerald-300 mt-1 block">
                      {new Date(brainRecommendation.data.validation?.targetTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      Window: {brainRecommendation.data.recommendation?.recommended_publish_window?.start}–{brainRecommendation.data.recommendation?.recommended_publish_window?.end}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-zinc-400 block text-[11px] uppercase font-semibold">Recommended Cadence Gap</span>
                    <span className="text-base font-bold text-white mt-1 block">
                      {brainRecommendation.data.recommendation?.recommended_gap_minutes?.min}–{brainRecommendation.data.recommendation?.recommended_gap_minutes?.max}m
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {brainRecommendation.data.recommendation?.recommended_posts_per_3h || 1} post(s) / 3h max
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-zinc-400 block text-[11px] uppercase font-semibold">Confidence & Support</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        brainRecommendation.data.recommendation?.confidence === 'HIGH'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : brainRecommendation.data.recommendation?.confidence === 'MEDIUM'
                          ? 'bg-indigo-500/20 text-indigo-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {brainRecommendation.data.recommendation?.confidence}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        (N={brainRecommendation.data.recommendation?.evidence_count})
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">
                      Exploration: {brainRecommendation.data.recommendation?.exploration?.percentage}%
                    </span>
                  </div>
                </div>

                {/* Reasoning & Adjustments */}
                <div className="p-4 rounded-xl bg-indigo-900/30 border border-indigo-500/30 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-indigo-200 block font-semibold">AI Recommendation Strategy & Rationale:</strong>
                      <p className="text-zinc-300 mt-0.5 leading-relaxed">
                        {brainRecommendation.data.recommendation?.reason}
                      </p>
                    </div>
                  </div>

                  {brainRecommendation.data.validation?.adjustments?.length > 0 && (
                    <div className="pt-2 border-t border-indigo-800/40 text-amber-300 text-[11px] space-y-1">
                      <strong>Deterministic Safety Guardrail Adjustments:</strong>
                      <ul className="list-disc list-inside space-y-0.5 text-zinc-300">
                        {brainRecommendation.data.validation.adjustments.map((adj: string, i: number) => (
                          <li key={i}>{adj}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Target Confession Preview & Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  {brainRecommendation.data.targetConfession ? (
                    <div className="text-xs text-zinc-300">
                      <span className="font-semibold text-white">Next Pending Confession: </span>
                      <span className="text-indigo-300 font-mono">#{brainRecommendation.data.targetConfession.row || 'Queue'}</span>
                      <p className="text-zinc-400 text-[11px] truncate max-w-md mt-0.5">
                        &quot;{brainRecommendation.data.targetConfession.text}&quot;
                      </p>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-400">
                      No approved unscheduled confessions currently pending in queue.
                    </div>
                  )}

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setIsOverrideModalOpen(true)}
                      className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all border border-white/10"
                    >
                      Override Format/Time
                    </button>
                    <button
                      onClick={handleAcceptRecommendation}
                      disabled={brainLoading || !brainRecommendation.data.targetConfession}
                      className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-xs font-semibold text-white transition-all shadow-md flex items-center gap-1.5"
                    >
                      <CalendarCheck className="w-3.5 h-3.5" />
                      Accept & Schedule Next Post
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Dedicated Posting Strategy Summary Card */}
            <div className="p-6 rounded-2xl bg-white border border-indigo-100 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-200">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-zinc-900">Posting Strategy &amp; Cadence</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                        {cadenceRec?.strategy?.replace(/_/g, ' ') || 'QUALITY FIRST'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Fewer posts + higher reach per post. Optimized for observation windows &amp; viral discovery.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Saturation Guard Active
                  </span>
                </div>
              </div>

              {/* Strategy Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-500 block text-[11px] font-semibold uppercase">Target Daily Volume</span>
                  <div className="text-lg font-bold text-zinc-900 mt-0.5 flex items-baseline gap-1">
                    <span>{cadenceRec?.recommendedDailyPosts || 4} posts/day</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 block mt-1">
                    Safe range: 2–6 posts (Cap = 6)
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-500 block text-[11px] font-semibold uppercase">Optimal Spacing Gap</span>
                  <div className="text-lg font-bold text-indigo-700 mt-0.5">
                    {cadenceRec?.recommendedGapRangeMinutes
                      ? `${cadenceRec.recommendedGapRangeMinutes.min}m – ${cadenceRec.recommendedGapRangeMinutes.max}m`
                      : '60m – 90m'}
                  </div>
                  <span className="text-[10px] text-zinc-500 block mt-1">
                    Mode: {cadenceRec?.mode === 'growth_optimized' ? 'Growth optimized' : 'Baseline exploration'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-500 block text-[11px] font-semibold uppercase">Peak Reach Window</span>
                  <div className="text-lg font-bold text-purple-700 mt-0.5">
                    {cadenceRec?.postingStrategySummary?.bestWindow || '19:00 – 21:00'}
                  </div>
                  <span className="text-[10px] text-zinc-500 block mt-1">
                    Best hour: {cadenceRec?.peakHoursSummary?.bestHour !== undefined ? `${cadenceRec.peakHoursSummary.bestHour}:00` : '19:00'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-500 block text-[11px] font-semibold uppercase">Primary Format &amp; Category</span>
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">
                    {cadenceRec?.postingStrategySummary?.bestFormat || 'CAROUSEL'}
                  </div>
                  <span className="text-[10px] text-zinc-500 block mt-1 truncate">
                    Top cat: {cadenceRec?.postingStrategySummary?.bestCategory || 'Relationship'}
                  </span>
                </div>
              </div>

              {/* Peak Hours & Observation Guard Details */}
              <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-indigo-950 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Cadence Rationale &amp; Timing Analysis:</span>
                  </div>
                  <p className="text-indigo-900/80 text-[11px] leading-relaxed">
                    {cadenceRec?.reason || 'Adaptive Growth scheduling monitors post velocity curves and delays successive posts when the active post is accelerating.'}
                  </p>
                </div>

                {cadenceRec?.peakHoursSummary && (
                  <div className="flex items-center gap-3 shrink-0 text-[11px] bg-white px-3 py-2 rounded-lg border border-indigo-100 text-zinc-700">
                    <div>
                      <span className="text-zinc-400 block text-[9px] uppercase font-bold">Best Slot</span>
                      <span className="font-bold text-emerald-700">{cadenceRec.peakHoursSummary.bestHour}:00</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-200" />
                    <div>
                      <span className="text-zinc-400 block text-[9px] uppercase font-bold">2nd Best</span>
                      <span className="font-bold text-indigo-700">{cadenceRec.peakHoursSummary.secondBestHour}:00</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-200" />
                    <div>
                      <span className="text-zinc-400 block text-[9px] uppercase font-bold">Avoid</span>
                      <span className="font-bold text-rose-600">{cadenceRec.peakHoursSummary.worstHour}:00</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Top KPI Grid (Mean & Median explicitly separated) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Median Reach
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-900">
                    {(overview?.posts_with_snapshots ?? 0) > 0 ? (overview?.median_reach?.toLocaleString() ?? 0) : '—'}
                  </span>
                  {(overview?.posts_with_snapshots ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">
                      (Mean: {overview?.mean_reach?.toLocaleString() ?? 0})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  {(overview?.posts_with_snapshots ?? 0) > 0
                    ? 'Accounts reached per post (median guards against viral distortion).'
                    : 'No analytics snapshots collected yet.'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Median Views / Plays
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-900">
                    {(overview?.posts_with_snapshots ?? 0) > 0 ? (overview?.median_views?.toLocaleString() ?? 0) : '—'}
                  </span>
                  {(overview?.posts_with_snapshots ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">
                      (Mean: {overview?.mean_views?.toLocaleString() ?? 0})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  {(overview?.posts_with_snapshots ?? 0) > 0
                    ? 'Total impressions across feed and discover surfaces.'
                    : 'Awaiting scheduled analytics polling.'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                  Avg Engagement Rate
                </span>
                <div className="text-2xl font-bold text-emerald-600">
                  {(overview?.posts_with_snapshots ?? 0) > 0 ? `${overview?.average_engagement_rate ?? 0}%` : '—'}
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  {(overview?.posts_with_snapshots ?? 0) > 0
                    ? '(Shares + Saves + Comments) ÷ Reach across observed sample.'
                    : 'Requires active observation snapshots.'}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block">
                    Posts Tracked
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    (overview?.posts_with_snapshots ?? 0) > 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  }`}>
                    {overview?.data_availability === 'COMPLETE'
                      ? 'COMPLETE'
                      : overview?.data_availability === 'PARTIAL'
                      ? 'PARTIAL'
                      : (overview?.total_published ?? 0) > 0
                      ? 'AWAITING SNAPSHOTS'
                      : 'NO DATA'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-indigo-600">
                  {overview?.posts_with_snapshots ?? 0}
                  <span className="text-sm font-normal text-zinc-400 ml-1.5">
                    / {overview?.total_published ?? 0} published
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  {overview?.status_message || `${overview?.posts_last_30_days ?? 0} published in last 30 days.`}
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

        {/* ================= TAB: ADAPTIVE SCHEDULING BRAIN ================= */}
        {activeTab === 'brain' && (
          <div className="space-y-6">
            {/* Account-Level Learning Summary Header Card */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                    <Brain className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Account-Level Learning Summary</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Aggregated multi-dimensional statistical baselines derived across all historical published confessions.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    learningOverview?.summary?.confidence === 'HIGH'
                      ? 'bg-emerald-100 text-emerald-800'
                      : learningOverview?.summary?.confidence === 'MEDIUM'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    Confidence: {learningOverview?.summary?.confidence || 'CALCULATING'}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    (N={learningOverview?.summary?.total_posts_analyzed ?? 0} Posts Analyzed)
                  </span>
                </div>
              </div>

              {/* Percentile Distributions & Key Learning Indices */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/70 space-y-2">
                  <span className="text-zinc-500 uppercase font-bold text-[11px] block">Views Distribution</span>
                  <div className="text-xl font-bold text-zinc-900">
                    P50: {learningOverview?.summary?.views_distribution?.p50?.toLocaleString() ?? 0}
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] text-zinc-600 pt-1 border-t border-zinc-200">
                    <div>P25: {learningOverview?.summary?.views_distribution?.p25?.toLocaleString() ?? 0}</div>
                    <div>P75: {learningOverview?.summary?.views_distribution?.p75?.toLocaleString() ?? 0}</div>
                    <div>P90: {learningOverview?.summary?.views_distribution?.p90?.toLocaleString() ?? 0}</div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/70 space-y-2">
                  <span className="text-zinc-500 uppercase font-bold text-[11px] block">Reach Distribution</span>
                  <div className="text-xl font-bold text-zinc-900">
                    P50: {learningOverview?.summary?.reach_distribution?.p50?.toLocaleString() ?? 0}
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] text-zinc-600 pt-1 border-t border-zinc-200">
                    <div>P25: {learningOverview?.summary?.reach_distribution?.p25?.toLocaleString() ?? 0}</div>
                    <div>P75: {learningOverview?.summary?.reach_distribution?.p75?.toLocaleString() ?? 0}</div>
                    <div>P90: {learningOverview?.summary?.reach_distribution?.p90?.toLocaleString() ?? 0}</div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/70 space-y-2">
                  <span className="text-zinc-500 uppercase font-bold text-[11px] block">Time to First Views</span>
                  <div className="text-xl font-bold text-indigo-600">
                    {learningOverview?.summary?.median_time_to_first_observed_view ?? 0}m
                  </div>
                  <p className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-200">
                    Sampled time until earliest views &gt; 0 observed.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/70 space-y-2">
                  <span className="text-zinc-500 uppercase font-bold text-[11px] block">Peak Growth Velocity</span>
                  <div className="text-xl font-bold text-emerald-600">
                    {learningOverview?.summary?.median_peak_velocity ?? 0} <span className="text-xs font-normal">v/hr</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-200">
                    Median steepest velocity interval in sample.
                  </p>
                </div>
              </div>

              {/* Best Performing Learned Patterns Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-indigo-600 font-semibold text-[10px] uppercase block">Top Category</span>
                  <span className="text-sm font-bold text-indigo-950 mt-1 block capitalize">
                    {learningOverview?.summary?.best_performing_category || 'General'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-indigo-600 font-semibold text-[10px] uppercase block">Top Format</span>
                  <span className="text-sm font-bold text-indigo-950 mt-1 block">
                    {learningOverview?.summary?.best_performing_format || 'IMAGE'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-indigo-600 font-semibold text-[10px] uppercase block">Publish Clock Window</span>
                  <span className="text-sm font-bold text-indigo-950 mt-1 block">
                    {learningOverview?.summary?.best_observed_window || '20:00 - 21:00'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-indigo-600 font-semibold text-[10px] uppercase block">Post Growth Elapsed</span>
                  <span className="text-sm font-bold text-indigo-950 mt-1 block">
                    {learningOverview?.summary?.best_observed_post_growth_window || '30–60m'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
                  <span className="text-indigo-600 font-semibold text-[10px] uppercase block">Best Cadence Gap</span>
                  <span className="text-sm font-bold text-indigo-950 mt-1 block">
                    {learningOverview?.summary?.best_observed_cadence || '60–90m'}
                  </span>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-[11px] text-zinc-500">
                <strong>Observational Note:</strong> {learningOverview?.summary?.disclaimer || 'Findings reflect observed historical sample. Algorithmic shifts and content quality variations may impact individual post outcomes.'}
              </div>
            </div>

            {/* Recency Trends (Last 30 Days vs Historical) */}
            {learningOverview?.recencyTrends && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-base">Recency Shifts (Last 30 Days vs Historical)</h3>
                    <p className="text-xs text-zinc-500">
                      Detects rising and declining engagement trends across categories and formats.
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-lg">
                    Threshold: ±15% Change
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 space-y-2">
                    <strong className="text-emerald-950 block font-semibold flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      Rising Trends:
                    </strong>
                    {learningOverview.recencyTrends.rising_categories?.length > 0 || learningOverview.recencyTrends.rising_formats?.length > 0 ? (
                      <ul className="space-y-1.5 list-disc list-inside text-emerald-900">
                        {learningOverview.recencyTrends.rising_categories?.map((r: any, i: number) => (
                          <li key={i}>{r.observed_summary}</li>
                        ))}
                        {learningOverview.recencyTrends.rising_formats?.map((r: any, i: number) => (
                          <li key={i}>{r.observed_summary}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-zinc-500">No categories or formats currently showing &gt; 15% acceleration.</p>
                    )}
                  </div>

                  <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-100 space-y-2">
                    <strong className="text-rose-950 block font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      Declining Trends:
                    </strong>
                    {learningOverview.recencyTrends.declining_categories?.length > 0 || learningOverview.recencyTrends.declining_formats?.length > 0 ? (
                      <ul className="space-y-1.5 list-disc list-inside text-rose-900">
                        {learningOverview.recencyTrends.declining_categories?.map((r: any, i: number) => (
                          <li key={i}>{r.observed_summary}</li>
                        ))}
                        {learningOverview.recencyTrends.declining_formats?.map((r: any, i: number) => (
                          <li key={i}>{r.observed_summary}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-zinc-500">No categories or formats currently showing &gt; 15% drop.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Post Density Analysis Table */}
            {learningOverview?.densityStats && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-base">Post Density Analysis</h3>
                    <p className="text-xs text-zinc-500">
                      Observes how clustering multiple posts in preceding 1h, 3h, 6h, and 24h windows correlates with reach.
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-lg">
                    Non-hardcoded Cadence Learning
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-zinc-500">
                        <th className="py-2.5 font-semibold">Preceding Window</th>
                        <th className="py-2.5 font-semibold">Density Bucket</th>
                        <th className="py-2.5 font-semibold">Sample Size</th>
                        <th className="py-2.5 font-semibold">Median Reach</th>
                        <th className="py-2.5 font-semibold">Median Views</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {learningOverview.densityStats.map((d: any, i: number) => (
                        <tr key={i} className="hover:bg-zinc-50/50">
                          <td className="py-2.5 font-semibold text-zinc-900">{d.window_hours} hour(s)</td>
                          <td className="py-2.5 font-medium text-indigo-600">{d.density_bucket}</td>
                          <td className="py-2.5 text-zinc-600 font-mono">N={d.sample_size}</td>
                          <td className="py-2.5 font-bold text-zinc-900">{d.median_reach?.toLocaleString() ?? 0}</td>
                          <td className="py-2.5 text-zinc-700">{d.median_views?.toLocaleString() ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Post Gap Detailed Analysis Table */}
            {learningOverview?.gapStats && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-base">Post Gap Spacing Analysis</h3>
                    <p className="text-xs text-zinc-500">
                      Observational correlation between previous post cooldown gap and subsequent post performance.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-zinc-500">
                        <th className="py-2.5 font-semibold">Gap Interval</th>
                        <th className="py-2.5 font-semibold">Sample Size</th>
                        <th className="py-2.5 font-semibold">Median Reach</th>
                        <th className="py-2.5 font-semibold">Median Views</th>
                        <th className="py-2.5 font-semibold">Observational Finding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {learningOverview.gapStats.map((g: any, i: number) => (
                        <tr key={i} className="hover:bg-zinc-50/50">
                          <td className="py-2.5 font-bold text-zinc-900">{g.gap_bucket}</td>
                          <td className="py-2.5 text-zinc-600 font-mono">N={g.sample_size}</td>
                          <td className="py-2.5 font-bold text-zinc-900">{g.median_reach?.toLocaleString() ?? 0}</td>
                          <td className="py-2.5 text-zinc-700">{g.median_views?.toLocaleString() ?? 0}</td>
                          <td className="py-2.5 text-zinc-600 max-w-md">{g.observational_finding}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB: SIMULATION & BACKTESTING ================= */}
        {activeTab === 'simulation' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-zinc-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-purple-50 text-purple-700 border border-purple-100">
                      <SlidersHorizontal className="w-5 h-5" />
                    </span>
                    <h3 className="font-bold text-zinc-900 text-lg">
                      30-Day Growth Intelligence Counterfactual Simulator
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
                    Backtest empirical decisions against real history. Simulates what account reach and efficiency would have been if Growth Intelligence 3.0 frequency caps, learned spacing, and format selection had actively controlled the queue.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-xl bg-zinc-100 p-1 text-xs font-semibold text-zinc-700">
                    {[7, 14, 30, 60].map((d) => (
                      <button
                        key={d}
                        onClick={() => handleRunSimulation(d)}
                        className={`px-3 py-1.5 rounded-lg transition-all ${
                          simulationDays === d
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'hover:text-zinc-900'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleRunSimulation(simulationDays)}
                    disabled={simulationLoading}
                    className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-all"
                    title="Re-run simulation"
                  >
                    <RefreshCw className={`w-4 h-4 ${simulationLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {simulationLoading ? (
                <div className="p-12 text-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-purple-600 animate-spin mx-auto" />
                  <p className="text-sm font-semibold text-zinc-700">Running historical queue simulation...</p>
                  <p className="text-xs text-zinc-400">Comparing actual posting timestamps and snapshots against empirical saturation models.</p>
                </div>
              ) : simulationResult ? (
                <div className="space-y-6">
                  {/* 3 Large KPI Comparison Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 1. Total Reach Impact */}
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 space-y-2">
                      <div className="text-xs font-bold text-purple-900 uppercase tracking-wide flex items-center justify-between">
                        <span>Total Projected Reach</span>
                        <TrendingUp className="w-4 h-4 text-purple-700" />
                      </div>
                      <div className="text-2xl font-black text-purple-950">
                        {simulationResult.simulated_total_reach.toLocaleString()}
                      </div>
                      <div className="text-xs text-purple-800 flex items-center gap-2">
                        <span>Actual: {simulationResult.baseline_total_reach.toLocaleString()}</span>
                        <span className="font-bold px-1.5 py-0.5 rounded bg-purple-200/60 text-purple-900 text-[11px]">
                          {simulationResult.projected_reach_lift_pct > 0 ? `+${simulationResult.projected_reach_lift_pct}%` : `${simulationResult.projected_reach_lift_pct}%`} Lift
                        </span>
                      </div>
                    </div>

                    {/* 2. Publishing Volume */}
                    <div className="p-5 rounded-2xl bg-zinc-50 border border-zinc-200 space-y-2">
                      <div className="text-xs font-bold text-zinc-700 uppercase tracking-wide flex items-center justify-between">
                        <span>Posts Published</span>
                        <Layers className="w-4 h-4 text-zinc-500" />
                      </div>
                      <div className="text-2xl font-black text-zinc-900">
                        {simulationResult.simulated_posts_count}{' '}
                        <span className="text-sm font-normal text-zinc-500">posts</span>
                      </div>
                      <div className="text-xs text-zinc-600">
                        Actual: {simulationResult.baseline_posts_count} posts (
                        {simulationResult.baseline_posts_count - simulationResult.simulated_posts_count > 0
                          ? `${simulationResult.baseline_posts_count - simulationResult.simulated_posts_count} fewer saturated posts`
                          : 'Same volume'}
                        )
                      </div>
                    </div>

                    {/* 3. Median Reach Per Post (Efficiency) */}
                    <div className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-100 space-y-2">
                      <div className="text-xs font-bold text-emerald-900 uppercase tracking-wide flex items-center justify-between">
                        <span>Median Reach Per Post</span>
                        <Gauge className="w-4 h-4 text-emerald-700" />
                      </div>
                      <div className="text-2xl font-black text-emerald-950">
                        {simulationResult.simulated_median_reach_per_post.toLocaleString()}
                      </div>
                      <div className="text-xs text-emerald-800">
                        Actual median: {simulationResult.baseline_median_reach_per_post.toLocaleString()}{' '}
                        (Higher median reach per post)
                      </div>
                    </div>
                  </div>

                  {/* Summary Callout */}
                  <div className="p-4 rounded-2xl bg-purple-950 text-purple-100 text-xs sm:text-sm leading-relaxed border border-purple-800/50 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block mb-0.5">Simulation Finding:</strong>
                      {simulationResult.summary}
                    </div>
                  </div>

                  {/* Historical Day-by-Day Table */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-zinc-900 text-sm">Day-by-Day Counterfactual Comparison</h4>
                    <div className="overflow-x-auto border border-zinc-200 rounded-2xl">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                            <th className="py-3 px-4 font-semibold">Date</th>
                            <th className="py-3 px-4 font-semibold">Actual Posts</th>
                            <th className="py-3 px-4 font-semibold">Simulated Posts</th>
                            <th className="py-3 px-4 font-semibold">Actual Reach</th>
                            <th className="py-3 px-4 font-semibold">Simulated Reach</th>
                            <th className="py-3 px-4 font-semibold">Primary Performance Driver</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {simulationResult.daily_comparisons.map((row) => (
                            <tr key={row.date} className="hover:bg-zinc-50/60">
                              <td className="py-3 px-4 font-mono font-semibold text-zinc-900">{row.date}</td>
                              <td className="py-3 px-4 font-medium text-zinc-700">{row.actual_posts}</td>
                              <td className="py-3 px-4 font-bold text-purple-700">{row.recommended_posts}</td>
                              <td className="py-3 px-4 text-zinc-600">{row.actual_total_reach.toLocaleString()}</td>
                              <td className="py-3 px-4 font-bold text-emerald-700">{row.simulated_total_reach.toLocaleString()}</td>
                              <td className="py-3 px-4 text-zinc-600 text-[11px]">{row.primary_driver}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-zinc-500">
                  Click &ldquo;Simulate 30 Days&rdquo; to compute historical counterfactual analysis.
                </div>
              )}
            </div>
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

            {/* Format Intelligence by Text Length */}
            {formatRecsList.length > 0 && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-base">Format Intelligence by Confession Length</h3>
                    <p className="text-xs text-zinc-500">
                      Empirical format recommendation based on confession word count brackets.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  {formatRecsList.map((f) => (
                    <div key={f.length_bracket} className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900 uppercase text-[11px]">{f.length_bracket} ({f.word_count_range})</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                          {f.recommended_format}
                        </span>
                      </div>
                      <div className="text-zinc-600 text-[11px] leading-relaxed">
                        {f.comparison_notes}
                      </div>
                      <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-200 flex justify-between">
                        <span>Sample Size: N={f.sample_size}</span>
                        {f.historical_median_reach > 0 && <span>Median Reach: {f.historical_median_reach}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: TIMING & GAPS ================= */}
        {activeTab === 'timing' && (
          <div className="space-y-6">
            {/* Live Adaptive Cadence Strategy & Scheduler Engine */}
            <div className="bg-gradient-to-br from-purple-50/60 via-indigo-50/40 to-white rounded-2xl border border-purple-200/80 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    <h3 className="font-bold text-zinc-900 text-lg">Growth Cadence Scheduling Strategy</h3>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Account-level historical performance analyzed to adapt future post intervals, queue spacing, and time windows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border shadow-xs ${
                    cadenceRec?.mode === 'growth_optimized'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : cadenceRec?.mode === 'manual'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-blue-50 text-blue-700 border-blue-300'
                  }`}>
                    {cadenceRec?.mode ? cadenceRec.mode.replace(/_/g, ' ') : 'Adaptive'}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-purple-800 border border-purple-200">
                    Confidence: {cadenceRec?.confidence || 'LOW'} (N={cadenceRec?.evidenceCount || 0})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="p-4 rounded-xl bg-white border border-purple-100 shadow-xs">
                  <span className="text-xs font-semibold text-zinc-500 block mb-1">Cadence Strategy</span>
                  <span className="text-base font-bold text-purple-950 block">
                    {cadenceRec?.strategy ? cadenceRec.strategy.replace(/_/g, ' ') : 'BALANCED CADENCE'}
                  </span>
                  <span className="text-[11px] text-purple-700 font-medium mt-1 block">
                    Support: {cadenceRec?.supportState?.replace(/_/g, ' ') || 'PRELIMINARY'}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white border border-purple-100 shadow-xs">
                  <span className="text-xs font-semibold text-zinc-500 block mb-1">Evidence-Backed Interval</span>
                  <span className="text-base font-bold text-zinc-900 block font-mono">
                    {cadenceRec?.recommendedGapRangeMinutes
                      ? `${cadenceRec.recommendedGapRangeMinutes.min}m – ${cadenceRec.recommendedGapRangeMinutes.max}m`
                      : '30m – 75m'}
                  </span>
                  <span className="text-[11px] text-zinc-500 mt-1 block">
                    Controlled Jitter Inside Range
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white border border-purple-100 shadow-xs">
                  <span className="text-xs font-semibold text-zinc-500 block mb-1">Frequency & Cooldown</span>
                  <span className="text-base font-bold text-zinc-900 block">
                    ~{cadenceRec?.recommendedPostsPerHour || 1}/hr · {cadenceRec?.cooldownMinutes || 30}m rest
                  </span>
                  <span className="text-[11px] text-zinc-500 mt-1 block">
                    Max {cadenceRec?.recommendedPostsPerThreeHours || 3} posts per 3h block
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white border border-purple-100 shadow-xs">
                  <span className="text-xs font-semibold text-zinc-500 block mb-1">Queue Diagnostics</span>
                  <span className="text-base font-bold text-zinc-900 block">
                    {queueDiagnostics?.futureScheduled ?? 0} scheduled
                  </span>
                  <span className="text-[11px] text-zinc-500 mt-1 block">
                    Today: {queueDiagnostics?.postsScheduledToday ?? 0}/{queueDiagnostics?.maxDailyPosts ?? 8} cap
                  </span>
                </div>
              </div>

              {cadenceRec?.reason && (
                <div className="p-3.5 rounded-xl bg-purple-100/60 border border-purple-200 text-xs text-purple-950 leading-relaxed">
                  <strong className="text-purple-900 font-semibold mr-1.5">Observational Reasoning:</strong>
                  {cadenceRec.reason}
                </div>
              )}
            </div>

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

            {/* Content Mix Strategy */}
            {contentMixList.length > 0 && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-bold text-zinc-900 text-base">Content Mix &amp; Category Efficiency</h3>
                    <p className="text-xs text-zinc-500">
                      Compares post volume share against actual reach share. Identifies categories that punch above their weight.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                        <th className="py-2.5 px-3 font-semibold">Category</th>
                        <th className="py-2.5 px-3 font-semibold">Post Share %</th>
                        <th className="py-2.5 px-3 font-semibold">Reach Share %</th>
                        <th className="py-2.5 px-3 font-semibold">Efficiency Ratio</th>
                        <th className="py-2.5 px-3 font-semibold">Growth Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {contentMixList.map((m) => (
                        <tr key={m.category} className="hover:bg-zinc-50/50">
                          <td className="py-2.5 px-3 font-bold text-zinc-900 capitalize">{m.category}</td>
                          <td className="py-2.5 px-3 text-zinc-700 font-mono">{m.historical_post_share_pct}% ({m.post_count} posts)</td>
                          <td className="py-2.5 px-3 font-semibold text-zinc-900 font-mono">{m.historical_reach_share_pct}%</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">{m.efficiency_ratio}x</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              m.recommendation === 'INCREASE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : m.recommendation === 'REDUCE'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-zinc-100 text-zinc-700'
                            }`}>
                              {m.recommendation}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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

        {/* ================= MODAL: OVERRIDE RECOMMENDATION ================= */}
        {isOverrideModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-zinc-200 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-zinc-900 text-base">Override AI Recommendation</h3>
                </div>
                <button onClick={() => setIsOverrideModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Select Custom Format</label>
                  <select
                    value={overrideFormat}
                    onChange={(e) => setOverrideFormat(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="IMAGE">Static Card (IMAGE)</option>
                    <option value="CAROUSEL">Multi-Slide (CAROUSEL)</option>
                    <option value="REEL">Animated 9:16 (REEL)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Custom Publish Time (Optional)</label>
                  <input
                    type="datetime-local"
                    value={overrideTime}
                    onChange={(e) => setOverrideTime(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-[10px] text-zinc-400 mt-0.5 block">
                    Leave blank to preserve validated spacing.
                  </span>
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 block mb-1">Override Reason</label>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. Breaking school confession, urgent posting"
                    className="w-full px-3 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-800">
                  <strong>Learning Accountability:</strong> Manual overrides are permanently logged to evaluate when human editorial choices outperform or underperform AI recommendations.
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOverrideModalOpen(false)}
                    className="px-4 py-2 border border-zinc-200 rounded-xl font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleOverrideRecommendation}
                    disabled={brainLoading}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Save Override
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
