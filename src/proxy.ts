import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * Session refresh + route protection.
 *
 * The proxy re-validates the Supabase session on every request and keeps the auth
 * cookies fresh. Unauthenticated requests to app routes are redirected to /login;
 * signed-in users never see the auth screens.
 *
 * `/api/*` is deliberately excluded: API routes authenticate themselves and must
 * answer with JSON, not an HTML redirect.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isApi = pathname.startsWith('/api/');

  // Without configuration the app cannot authenticate anyone. Public screens
  // explain exactly what is missing rather than pretending to work.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: 'VozPilot is not connected to a database yet. Configure Supabase to continue.', code: 'not_configured' },
        { status: 503 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('setup', 'required');
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (isApi) {
    // API routes authenticate themselves so they can return structured errors.
    return response;
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && isPublic && pathname !== '/reset-password') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)'],
};
