/**
 * POST /api/auth/logout
 *
 * Clears the session cookie. Public endpoint (no auth required to log out).
 */
import { NextResponse } from 'next/server';
import { buildSessionClearCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true, message: 'Logged out successfully.' });
  response.headers.set('Set-Cookie', buildSessionClearCookieHeader());
  return response;
}
