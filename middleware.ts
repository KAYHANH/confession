import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

// ─── Route Classification ──────────────────────────────────────────────────────

/** UI routes that require an authenticated session */
const PROTECTED_UI_ROUTES = [
  '/dashboard',
  '/confessions',
  '/review',
  '/calendar',
  '/published',
  '/templates',
  '/settings',
  '/logs',
  '/growth',
];

/** API routes that do NOT require auth (public endpoints) */
const PUBLIC_API_PREFIXES = [
  '/api/auth',          // login / logout
  '/api/health',        // uptime ping — intentionally public
  '/api/cron',          // protected separately via CRON_SECRET
];

// ─── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. Protected UI routes ─────────────────────────────────────────────────
  const isProtectedUI = PROTECTED_UI_ROUTES.some((route) => pathname.startsWith(route));

  if (isProtectedUI) {
    if (process.env.NODE_ENV === 'development') {
      return NextResponse.next();
    }
    const sessionCookie = request.cookies.get(SESSION_COOKIE);

    if (!sessionCookie?.value) {
      return redirectToLogin(request, pathname);
    }

    // Cryptographically verify the token (HMAC-SHA256 + expiry)
    const payload = await verifySessionToken(sessionCookie.value);
    if (!payload) {
      // Token is forged, expired, or tampered — clear cookie and redirect
      const loginUrl = buildLoginUrl(request, pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    // Valid session — continue
    return NextResponse.next();
  }

  // ── 2. Protected API routes (all /api/** except public list) ───────────────
  if (pathname.startsWith('/api/')) {
    const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));

    if (!isPublicApi) {
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.next();
      }
      const sessionCookie = request.cookies.get(SESSION_COOKIE);

      if (!sessionCookie?.value) {
        return NextResponse.json(
          { error: 'Unauthorized. Session required.' },
          { status: 401 }
        );
      }

      const payload = await verifySessionToken(sessionCookie.value);
      if (!payload) {
        const response = NextResponse.json(
          { error: 'Unauthorized. Session expired or invalid.' },
          { status: 401 }
        );
        response.cookies.delete(SESSION_COOKIE);
        return response;
      }

      // Attach session subject as a request header for downstream route handlers
      const requestWithSession = NextResponse.next();
      requestWithSession.headers.set('x-session-sub', payload.sub);
      return requestWithSession;
    }
  }

  return NextResponse.next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLoginUrl(request: NextRequest, redirect: string): URL {
  const loginUrl = new URL('/login', request.url);
  if (redirect && redirect !== '/login') {
    loginUrl.searchParams.set('redirect', redirect);
  }
  return loginUrl;
}

function redirectToLogin(request: NextRequest, pathname: string) {
  return NextResponse.redirect(buildLoginUrl(request, pathname));
}

// ─── Matcher ──────────────────────────────────────────────────────────────────

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (Next.js build assets)
     *  - _next/image   (image optimisation)
     *  - favicon.ico
     *  - /generated/*  (served confession card images — intentionally public)
     */
    '/((?!_next/static|_next/image|favicon.ico|generated).*)',
  ],
};
