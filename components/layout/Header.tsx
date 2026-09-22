'use client';

import React, { useState } from 'react';
import { RefreshCw, Clock, Sparkles } from 'lucide-react';
import { useToast } from '../ui/ToastContext';

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<{ isLive: boolean }>({ isLive: false });
  const { success, error } = useToast();

  React.useEffect(() => {
    const checkStatus = () => {
      fetch('/api/sheets/status')
        .then((res) => res.json())
        .then((data) => {
          const isConfigured = Boolean(data.spreadsheet_id && !data.spreadsheet_id.startsWith('mock'));
          setSheetStatus({ isLive: isConfigured });
        })
        .catch(() => {});
    };
    checkStatus();
    window.addEventListener('confessionflow:refresh', checkStatus);
    return () => window.removeEventListener('confessionflow:refresh', checkStatus);
  }, []);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }
      success(data.message || 'Google Sheet synced successfully!');
      // Trigger a light refresh of window event for active data tables
      window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
    } catch (err: any) {
      error(err?.message || 'Sync failed. Please verify sheet settings.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="h-16 border-b border-zinc-200 bg-white/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-30">
      <div>
        {title && <h1 className="text-xl font-bold text-zinc-900 tracking-tight">{title}</h1>}
        {subtitle && <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {/* Timezone Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100/80 text-zinc-600 text-xs font-medium border border-zinc-200/60">
          <Clock className="w-3.5 h-3.5 text-zinc-600" />
          <span>Asia/Kolkata (IST)</span>
        </div>

        {/* Live / Setup Status Pill */}
        {sheetStatus.isLive ? (
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Live Sheet Connected</span>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Connect Your Sheet</span>
          </div>
        )}

        {/* Quick Sync Button */}
        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>
    </header>
  );
}
