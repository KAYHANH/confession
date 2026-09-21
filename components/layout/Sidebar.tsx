'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquareText,
  Inbox,
  CalendarDays,
  CheckCircle2,
  Palette,
  ShieldAlert,
  Instagram,
  FileSpreadsheet,
  Settings,
  ScrollText,
  LogOut,
  Sparkles,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Confessions', href: '/confessions', icon: MessageSquareText },
  { label: 'Review Queue', href: '/review', icon: Inbox, badge: 'review' },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Published', href: '/published', icon: CheckCircle2 },
  { label: 'Templates', href: '/templates', icon: Palette },
  { label: 'Moderation', href: '/settings?tab=moderation', icon: ShieldAlert },
  { label: 'Instagram', href: '/settings?tab=instagram', icon: Instagram },
  { label: 'Google Sheets', href: '/settings?tab=google-sheets', icon: FileSpreadsheet },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Activity Logs', href: '/logs', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white border-r border-zinc-200 flex flex-col h-screen sticky top-0 shrink-0 select-none">
      {/* Brand Header */}
      <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 via-brand-500 to-rose-400 flex items-center justify-center text-white shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-lg text-zinc-900 tracking-tight block leading-none">
              Confession<span className="text-brand-500">Flow</span>
            </span>
            <span className="text-[11px] font-medium text-zinc-600 tracking-wider uppercase mt-1 block">
              Social Automation
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname?.startsWith(item.href) && !item.href.includes('?'));

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/80'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-zinc-600'}`} />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Admin Profile & Logout */}
      <div className="p-4 border-t border-zinc-100 bg-zinc-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-zinc-200 border border-zinc-300 flex items-center justify-center text-zinc-700 font-bold text-xs">
              AD
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-zinc-900 truncate">Administrator</p>
              <p className="text-xs text-zinc-600 truncate">admin@confessionflow.io</p>
            </div>
          </div>
          <Link
            href="/login"
            title="Logout"
            className="p-2 text-zinc-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
