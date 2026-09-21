'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Send,
  Eye,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Confession } from '@/types';
import { useToast } from '@/components/ui/ToastContext';

export default function CalendarPage() {
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const { success, error } = useToast();

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/confessions?limit=200');
      const data = await res.json();
      setConfessions(data.confessions || []);
    } catch {
      error('Failed to load calendar events');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  const handleCancelSchedule = async (id: string) => {
    if (!confirm('Are you sure you want to remove this post from the publishing schedule?')) return;
    try {
      const res = await fetch(`/api/confessions/${id}/cancel-schedule`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to cancel schedule');
      success('Schedule cancelled');
      loadCalendarData();
    } catch (err: any) {
      error(err?.message || 'Error cancelling schedule');
    }
  };

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // Map confessions to calendar dates
  const postsForDay = (day: number) => {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return confessions.filter((c) => {
      const schedDate = c.scheduled_at ? c.scheduled_at.slice(0, 10) : '';
      const pubDate = c.published_at ? c.published_at.slice(0, 10) : '';
      return schedDate === dayStr || pubDate === dayStr;
    });
  };

  return (
    <DashboardLayout
      title="Content Publishing Calendar"
      subtitle="Visual overview of automated scheduled queues and broadcast history"
    >
      {/* Calendar Header Controls */}
      <div className="bg-white p-5 rounded-2xl border border-zinc-200/80 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
              {monthNames[month]} {year}
            </h2>
            <p className="text-xs text-zinc-500">Asia/Kolkata timezone</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="px-3.5 py-1.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
          >
            Today
          </button>
          <div className="flex items-center border border-zinc-200 rounded-xl overflow-hidden bg-white">
            <button
              onClick={prevMonth}
              className="p-2 text-zinc-600 hover:bg-zinc-50 border-r border-zinc-200 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextMonth}
              className="p-2 text-zinc-600 hover:bg-zinc-50 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden">
        {/* Day of week labels */}
        <div className="grid grid-cols-7 text-center border-b border-zinc-100 bg-zinc-50/70 text-zinc-500 text-xs font-bold py-3 uppercase tracking-wider">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-zinc-100 min-h-[560px]">
          {/* Empty cells before month start */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-zinc-50/30 p-2 min-h-[110px]" />
          ))}

          {/* Month day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const items = postsForDay(dayNum);
            const isToday =
              new Date().getDate() === dayNum &&
              new Date().getMonth() === month &&
              new Date().getFullYear() === year;

            return (
              <div
                key={`day-${dayNum}`}
                className={`p-2 min-h-[110px] flex flex-col justify-between transition-colors ${
                  isToday ? 'bg-amber-50/20' : 'hover:bg-zinc-50/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                      isToday
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'text-zinc-700'
                    }`}
                  >
                    {dayNum}
                  </span>
                  {items.length > 0 && (
                    <span className="text-[10px] font-semibold text-zinc-400">
                      {items.length} post{items.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Post pills in cell */}
                <div className="space-y-1.5 overflow-y-auto max-h-24">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`p-1.5 rounded-lg border text-[10px] font-medium transition-all group ${
                        item.status === 'PUBLISHED'
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                          : 'bg-indigo-50/80 border-indigo-200 text-indigo-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold truncate">
                          #{String(item.google_sheet_row).padStart(3, '0')}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link href={`/confessions/${item.id}`} title="View">
                            <Eye className="w-3 h-3 text-zinc-600 hover:text-zinc-900" />
                          </Link>
                          {item.status === 'SCHEDULED' && (
                            <button
                              onClick={() => handleCancelSchedule(item.id)}
                              title="Cancel Schedule"
                              className="text-rose-600 hover:text-rose-800"
                            >
                              <XCircle className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="truncate text-[9px] opacity-80 mt-0.5">
                        {item.cleaned_text || item.original_text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
