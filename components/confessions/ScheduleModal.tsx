'use client';

import React, { useState } from 'react';
import { X, Calendar, Clock, Loader2 } from 'lucide-react';
import { Confession } from '@/types';
import { useToast } from '../ui/ToastContext';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  confession: Confession;
  onSuccess?: () => void;
}

export function ScheduleModal({
  isOpen,
  onClose,
  confession,
  onSuccess,
}: ScheduleModalProps) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().slice(0, 10);

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('19:30');
  const [loading, setLoading] = useState(false);
  const { success, error } = useToast();

  if (!isOpen) return null;

  const handleSchedule = async () => {
    setLoading(true);
    try {
      const scheduledIso = new Date(`${date}T${time}:00`).toISOString();

      const res = await fetch(`/api/confessions/${confession.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledIso }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to schedule');
      }

      success(`Scheduled for ${date} at ${time}`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      error(err?.message || 'Failed to schedule confession');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl border border-zinc-100 relative">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-6 right-6 p-2 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-900">Schedule Post</h3>
            <p className="text-xs text-zinc-600">Automate publishing at optimal engagement hours</p>
          </div>
        </div>

        <div className="space-y-4 my-6">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Publish Date</label>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Publish Time (Asia/Kolkata)</label>
            <div className="relative">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
          </div>

          <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200/60 flex items-center gap-2 text-xs text-zinc-600">
            <Clock className="w-4 h-4 text-zinc-600 shrink-0" />
            <span>Post will automatically publish via Cron worker when scheduled time arrives.</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleSchedule}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            <span>{loading ? 'Scheduling...' : 'Set Schedule'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
