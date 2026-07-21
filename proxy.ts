import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { employeeMayCallApiPath, employeeMayOpenDashboardPath } from './lib/employee-access';

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    console.log(`[Proxy] path=${pathname}`);

    // Skip static assets and next internals
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/public') ||
      pathname === '/favicon.ico'
    ) {
      return NextResponse.next();
    }

    // Create Supabase server client with SSR support
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Proxy] Missing Supabase environment variables');
      return NextResponse.next();
    }

    // Create server client for this request
    const response = NextResponse.next();
    
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    const hasUser = !!user && !authError;
    console.log(`[Proxy] user=${hasUser ? 'YES' : 'NO'}`);

    // Route protection: redirect unauthenticated away from /dashboard
    if (pathname.startsWith('/dashboard') && !hasUser) {
      console.log(`[Proxy] REDIRECT /dashboard -> /login (not authenticated)`);
      const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
      // Copy cookies from response to redirect response (critical!)
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    if (hasUser && user && (pathname.startsWith('/dashboard') || pathname.startsWith('/api'))) {
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role, status').eq('id', user.id).maybeSingle();
      if (profileError || !profile) {
        if (pathname.startsWith('/api')) return NextResponse.json({ error: 'Authorization temporarily unavailable', code: 'AUTHORIZATION_UNAVAILABLE' }, { status: 503 });
        return new NextResponse('Authorization temporarily unavailable', { status: 503 });
      }
      if (profile?.status === 'active' && profile.role === 'employee') {
        if (pathname.startsWith('/dashboard') && !employeeMayOpenDashboardPath(pathname)) return NextResponse.redirect(new URL('/dashboard', request.url));
        const apiDenied = pathname.startsWith('/api') && (!employeeMayCallApiPath(pathname) || (pathname.startsWith('/api/shifts') && request.method !== 'GET'));
        if (apiDenied) return NextResponse.json({ error: 'Forbidden', code: 'EMPLOYEE_ACCESS_DENIED' }, { status: 403 });
      }
    }

    // Route protection: redirect authenticated away from /login
    if (pathname === '/login' && hasUser) {
      console.log(`[Proxy] REDIRECT /login -> /dashboard (already authenticated)`);
      const redirectResponse = NextResponse.redirect(new URL('/dashboard', request.url));
      // Copy cookies from response to redirect response (critical!)
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    console.log(`[Proxy] PASS through (no redirect needed)`);
    // Return response with refreshed cookies
    return response;
  } catch (error) {
    console.error('[Proxy] Error:', error);
    if (request.nextUrl.pathname.startsWith('/api')) return NextResponse.json({ error: 'Authorization temporarily unavailable', code: 'AUTHORIZATION_UNAVAILABLE' }, { status: 503 });
    if (request.nextUrl.pathname.startsWith('/dashboard')) return new NextResponse('Authorization temporarily unavailable', { status: 503 });
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
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
