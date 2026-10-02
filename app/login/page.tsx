'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/ToastContext';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100/60 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const { success, error } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setAttemptsRemaining(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        credentials: 'same-origin',
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          error('Too many failed attempts. Try again in 15 minutes.');
        } else if (res.status === 401) {
          if (typeof data.attemptsRemaining === 'number') {
            setAttemptsRemaining(data.attemptsRemaining);
          }
          error(data.error || 'Invalid email or password.');
        } else {
          error(data.error || 'Login failed. Please try again.');
        }
        return;
      }

      success('Welcome back!');
      // Use replace so back-button does not return to login after auth
      router.replace(redirectPath.startsWith('/') ? redirectPath : '/dashboard');
    } catch {
      error('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100/60 flex items-center justify-center p-4 font-sans select-none">
      <div className="max-w-md w-full">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-rose-400 flex items-center justify-center text-white mx-auto shadow-xl shadow-brand-500/25 mb-4 animate-in zoom-in-95">
            <Sparkles className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            Confession<span className="text-brand-500">Flow</span>
          </h1>
          <p className="text-xs font-medium text-zinc-500 mt-1">
            Automated Social Media Publishing Platform
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl p-8 border border-zinc-200/80 shadow-xl shadow-zinc-200/50">
          <div className="flex items-center gap-2 mb-6 text-zinc-900 font-bold text-sm">
            <Lock className="w-4 h-4 text-brand-600" />
            <span>Admin Authentication</span>
          </div>

          <form onSubmit={handleLogin} className="space-y-4" autoComplete="on">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5" htmlFor="email">
                Admin Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="username email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 disabled:opacity-60"
                  placeholder="admin@confessionflow.io"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 disabled:opacity-60"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* Attempts warning */}
            {attemptsRemaining !== null && attemptsRemaining <= 2 && (
              <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                ⚠️ {attemptsRemaining === 0
                  ? 'Account locked. Try again in 15 minutes.'
                  : `Warning: ${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining before lockout.`}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full mt-2 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold shadow-md transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-zinc-400 mt-6">
          ConfessionFlow · Admin Portal · All access is logged.
        </p>
      </div>
    </div>
  );
}
