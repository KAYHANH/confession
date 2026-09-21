'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Lock, Mail, ArrowRight, ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/ToastContext';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@confessionflow.io');
  const [password, setPassword] = useState('admin123456');
  const [loading, setLoading] = useState(false);
  const { success, error } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // If mock mode active or placeholder Supabase, allow instant demo admin login
      if (
        process.env.MOCK_EXTERNAL_APIS === 'true' ||
        process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('placeholder')
      ) {
        document.cookie = 'confessionflow_session=admin; path=/; max-age=86400';
        success('Welcome back, Admin! (Demo Mode)');
        router.push('/dashboard');
        return;
      }

      // Real Supabase Auth
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      if (data.session) {
        document.cookie = `confessionflow_session=${data.session.access_token}; path=/; max-age=86400`;
        success('Logged in successfully!');
        router.push('/dashboard');
      }
    } catch (err: any) {
      error(err?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = () => {
    document.cookie = 'confessionflow_session=admin; path=/; max-age=86400';
    success('Logged in as Administrator (Instant Demo Access)');
    router.push('/dashboard');
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

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Admin Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  placeholder="admin@confessionflow.io"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
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

          {/* Quick Demo Access Button */}
          <div className="mt-6 pt-6 border-t border-zinc-100">
            <button
              onClick={handleDemoLogin}
              type="button"
              className="w-full py-2.5 rounded-xl border border-brand-200 bg-brand-50/60 hover:bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-brand-600" />
              <span>Enter Demo Admin Session (One-Click)</span>
            </button>
            <p className="text-[11px] text-center text-zinc-400 mt-2">
              For local preview and testing without pre-registering Supabase email.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
