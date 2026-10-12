'use client';

import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { supabase } from '@/lib/supabase/client';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export function DashboardLayout({ children, title, subtitle }: DashboardLayoutProps) {
  // Global Realtime & Cross-Tab Synchronization Bridge (Requirements 10, 11, 12, 13)
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('confessionflow_settings');
      channel.onmessage = (event) => {
        if (event.data?.type === 'SETTINGS_UPDATED') {
          window.dispatchEvent(new CustomEvent('confessionflow:settings_updated', { detail: event.data }));
          window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
        }
      };
    } catch {}

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'confessionflow_settings_version') {
        const v = Number(event.newValue);
        window.dispatchEvent(new CustomEvent('confessionflow:settings_updated', { detail: { version: v } }));
        window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
      }
    };
    window.addEventListener('storage', handleStorage);

    let supabaseChannel: any = null;
    try {
      const isConfigured =
        typeof window !== 'undefined' &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder');

      if (isConfigured) {
        supabaseChannel = supabase
          .channel('realtime:global_settings')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'settings' },
            (payload) => {
              window.dispatchEvent(new CustomEvent('confessionflow:settings_updated', { detail: payload }));
              window.dispatchEvent(new CustomEvent('confessionflow:refresh'));
            }
          )
          .subscribe();
      }
    } catch {}

    return () => {
      channel?.close();
      window.removeEventListener('storage', handleStorage);
      if (supabaseChannel) {
        try {
          supabase.removeChannel(supabaseChannel);
        } catch {}
      }
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-zinc-50/60 font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} subtitle={subtitle} />
        <main className="flex-1 p-8 max-w-7xl w-full mx-auto animate-in fade-in duration-200">
          {children}
        </main>
      </div>
    </div>
  );
}
