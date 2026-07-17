import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl;

    console.log(`[Proxy] path=${pathname}`);

    // Skip static assets and next internals
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api') ||
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
    let response = NextResponse.next();
    
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
