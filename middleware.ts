import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protected paths
  const protectedRoutes = [
    '/dashboard',
    '/confessions',
    '/review',
    '/calendar',
    '/published',
    '/templates',
    '/settings',
    '/logs',
  ];

  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtected) {
    // Check session cookie
    const sessionCookie = request.cookies.get('confessionflow_session');

    if (!sessionCookie) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|generated).*)'],
};
