import { type NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;
    
    // Check for session token in cookies (set by browser client)
    const authToken = request.cookies.get('sb-auth-token')?.value;
    const hasSession = !!authToken;

    console.log('[Middleware]', `pathname=${pathname}, hasSession=${hasSession}`);

    // Public routes (no auth required)
    const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/'];
    const isPublicRoute = publicRoutes.includes(pathname);

    // Protected routes (auth required)
    const isProtectedRoute = pathname.startsWith('/dashboard');

    // Redirect authenticated users away from login page
    if (hasSession && pathname === '/login') {
      console.log('[Middleware] Authenticated user at /login, redirecting to /dashboard');
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // Redirect unauthenticated users away from protected routes
    if (!hasSession && isProtectedRoute) {
      console.log('[Middleware] Unauthenticated user at protected route, redirecting to /login');
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // Allow the request to proceed
    return NextResponse.next();
  } catch (error) {
    console.error('[Middleware] Error:', error);
    // If there's an error checking auth, allow the request to proceed
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
