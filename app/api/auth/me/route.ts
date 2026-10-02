/**
 * GET /api/auth/me
 *
 * Returns the current session info if authenticated.
 * Useful for client-side session checks without exposing the raw token.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    sub: session.sub,
    exp: session.exp,
    iat: session.iat,
  });
}
