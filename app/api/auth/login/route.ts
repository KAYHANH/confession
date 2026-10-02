/**
 * POST /api/auth/login
 *
 * Server-side login endpoint. Verifies admin credentials against env vars,
 * issues an HMAC-signed session token, and sets it as an HttpOnly cookie.
 *
 * Public endpoint — does not require prior authentication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  verifyAdminCredentials,
  createSessionToken,
  buildSessionCookieHeader,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ─── Rate Limiter (in-process, lightweight) ───────────────────────────────────
// Tracks failed attempts per IP. Resets on server restart (acceptable for admin-only app).
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const record = failedAttempts.get(ip);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    failedAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const existing = failedAttempts.get(ip);
  const resetAt = Date.now() + LOCKOUT_SECONDS * 1000;
  if (existing && Date.now() < existing.resetAt) {
    failedAttempts.set(ip, { count: existing.count + 1, resetAt: existing.resetAt });
  } else {
    failedAttempts.set(ip, { count: 1, resetAt });
  }
}

function clearFailedAttempts(ip: string): void {
  failedAttempts.delete(ip);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Rate limit check
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many failed login attempts. Try again in 15 minutes.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Validation failed.' },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  // ── Supabase Auth (when configured) ──────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const isSupabaseConfigured =
    supabaseUrl && !supabaseUrl.includes('placeholder') && supabaseKey;

  if (isSupabaseConfigured) {
    try {
      // Dynamic import to avoid bundling supabase in Edge if not needed
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl!, supabaseKey!);

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !data.session) {
        recordFailedAttempt(ip);
        console.warn(`[Auth] Supabase login failed for ${email} from ${ip}:`, authError?.message);
        return NextResponse.json(
          { error: 'Invalid email or password.' },
          { status: 401 }
        );
      }

      // Issue our own signed session token (Supabase token is server-only)
      const token = await createSessionToken(email);
      clearFailedAttempts(ip);
      console.info(`[Auth] Supabase login success for ${email} from ${ip}`);

      const response = NextResponse.json({ ok: true, message: 'Logged in successfully.' });
      response.headers.set('Set-Cookie', buildSessionCookieHeader(token));
      return response;
    } catch (err: unknown) {
      console.error('[Auth] Supabase login error:', err);
      return NextResponse.json({ error: 'Authentication service error.' }, { status: 500 });
    }
  }

  // ── Env-based Admin Credentials ───────────────────────────────────────────
  const isValid = verifyAdminCredentials(email, password);

  if (!isValid) {
    recordFailedAttempt(ip);
    const record = failedAttempts.get(ip);
    const remaining = record ? Math.max(0, MAX_ATTEMPTS - record.count) : MAX_ATTEMPTS;
    console.warn(`[Auth] Failed login for ${email} from ${ip}. Attempts remaining: ${remaining}`);
    return NextResponse.json(
      {
        error: 'Invalid email or password.',
        attemptsRemaining: remaining,
      },
      { status: 401 }
    );
  }

  const token = await createSessionToken(email);
  clearFailedAttempts(ip);
  console.info(`[Auth] Admin login success for ${email} from ${ip}`);

  const response = NextResponse.json({ ok: true, message: 'Logged in successfully.' });
  response.headers.set('Set-Cookie', buildSessionCookieHeader(token));
  return response;
}
