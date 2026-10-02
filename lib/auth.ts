/**
 * lib/auth.ts — ConfessionFlow Authentication Utilities
 *
 * Provides:
 *  - HMAC-SHA256 signed session token generation & verification (Edge-compatible)
 *  - Server-side API route authentication guard
 *  - Cron secret verification (unified)
 *  - Cookie name constants
 *
 * NEVER import this in client components — it is server-only.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'confessionflow_session';
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Returns the AUTH_SECRET env var or throws clearly if missing.
 * In local dev without AUTH_SECRET, falls back to a predictable dev-only key.
 */
function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.trim().length >= 16) return secret.trim();

  // Dev-only fallback — logs a prominent warning so it is not missed
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[ConfessionFlow Auth] WARNING: AUTH_SECRET is not set. ' +
        'Using insecure dev-only fallback. Set AUTH_SECRET in .env.local for real security.'
    );
    return 'confessionflow-dev-secret-do-not-use-in-production-32chars';
  }

  throw new Error(
    '[ConfessionFlow Auth] FATAL: AUTH_SECRET environment variable is required in production. ' +
      'Set a strong random secret (min 32 chars) in your Render/environment settings.'
  );
}

/**
 * Encode bytes as lowercase hex string.
 */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── Session Token API ────────────────────────────────────────────────────────

export interface SessionPayload {
  sub: string; // user identifier (email or 'admin')
  iat: number; // issued-at unix timestamp (seconds)
  exp: number; // expiry unix timestamp (seconds)
}

/**
 * Create a signed session token: base64url(payload).HMAC
 * Uses Web Crypto API — works in both Node.js and Edge runtimes.
 */
export async function createSessionToken(sub: string): Promise<string> {
  const secret = getAuthSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub,
    iat: now,
    exp: now + SESSION_DURATION_SECONDS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigHex = bufToHex(sig);

  return `${payloadB64}.${sigHex}`;
}

/**
 * Verify a session token created by createSessionToken.
 * Returns the decoded payload if valid, null otherwise.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getAuthSecret();
    const dotIdx = token.lastIndexOf('.');
    if (dotIdx < 1) return null;

    const payloadB64 = token.slice(0, dotIdx);
    const providedSig = token.slice(dotIdx + 1);

    // Re-compute HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const expectedSigBuf = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payloadB64)
    );
    const expectedSig = bufToHex(expectedSigBuf);

    if (!safeCompare(providedSig, expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as SessionPayload;

    // Check expiry
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Request-Level Auth Guard ─────────────────────────────────────────────────

/**
 * Read and verify the session token from the incoming request's cookie.
 * Returns the decoded payload if authenticated, null if not.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  return verifySessionToken(cookie.value);
}

/**
 * requireAuth — use at the TOP of every protected API route handler.
 *
 * Returns { session } on success, or a 401 NextResponse to return immediately.
 *
 * Usage:
 *   const auth = await requireAuth(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.session is available here
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ session: SessionPayload } | NextResponse> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized. Please log in to access this resource.' },
      { status: 401 }
    );
  }
  return { session };
}

// ─── Cron Secret Verification ─────────────────────────────────────────────────

/**
 * Verify an incoming cron/webhook request using CRON_SECRET.
 * Accepts the secret via:
 *  - Authorization: Bearer <secret>
 *  - x-cron-secret: <secret> header
 *
 * If CRON_SECRET is unset: allows in non-production, blocks in production.
 */
export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    // Allow in dev without a secret, block in production
    return process.env.NODE_ENV !== 'production';
  }

  const authHeader = req.headers.get('authorization');
  const customHeader = req.headers.get('x-cron-secret');

  if (customHeader && safeCompare(customHeader, secret)) return true;
  if (authHeader) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (safeCompare(bearer, secret)) return true;
  }

  return false;
}

// ─── Admin Credentials Verification ──────────────────────────────────────────

/**
 * Verify admin email + password against environment variables.
 *
 * Expected env vars:
 *   ADMIN_EMAIL    (default: admin@confessionflow.io)
 *   ADMIN_PASSWORD (REQUIRED — no default in production)
 *
 * Returns true only if both match exactly (constant-time comparison).
 */
export function verifyAdminCredentials(email: string, password: string): boolean {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@confessionflow.io').trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!adminPassword) {
    // In production, refuse to authenticate without a configured password
    if (process.env.NODE_ENV === 'production') return false;
    // In dev, allow the default password as a convenience — warn loudly
    console.warn(
      '[ConfessionFlow Auth] WARNING: ADMIN_PASSWORD not set. ' +
        'Using insecure dev-only password. Set ADMIN_PASSWORD in .env.local.'
    );
    const devPassword = 'admin123456';
    return safeCompare(email, adminEmail) && safeCompare(password, devPassword);
  }

  return safeCompare(email, adminEmail) && safeCompare(password, adminPassword);
}

// ─── Cookie Builder ───────────────────────────────────────────────────────────

/**
 * Build a Set-Cookie header string for the session cookie.
 * HttpOnly, SameSite=Lax, Secure in production.
 */
export function buildSessionCookieHeader(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build a Set-Cookie header string that clears/expires the session cookie.
 */
export function buildSessionClearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
