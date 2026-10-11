import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { syncUserProfile } from '@/lib/supabase/profile';
import { getSiteUrl } from '@/lib/siteUrl';

const defaultSupabaseUrl = 'https://himvtlmqcjtutstdrpjg.supabase.co';
const defaultPublishableKey = 'sb_publishable_9kLInkw9IYWc_4QMRNWHiQ_LtBUqkr2';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL.trim() !== '')
  ? process.env.NEXT_PUBLIC_SUPABASE_URL
  : defaultSupabaseUrl;
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() !== '')
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  : (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim() !== '')
  ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  : defaultPublishableKey;

/**
 * Validates and sanitizes internal redirect target to strictly prevent open redirects.
 */
function sanitizeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/dashboard';
  const trimmed = rawNext.trim();

  // Reject external protocol schemes or protocol-relative URLs (//attacker.com)
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('://') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
  ) {
    return '/dashboard';
  }

  // Ensure it starts with a single slash
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }

  return trimmed;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');
  const rawNext = requestUrl.searchParams.get('next');
  const safeNext = sanitizeNextPath(rawNext);
  const baseUrl = getSiteUrl();

  if (error) {
    console.error('Supabase Auth callback received error from provider:', error, errorDescription);
    const redirectUrl = new URL(`${baseUrl}/login`);
    redirectUrl.searchParams.set('error', error);
    if (errorDescription) {
      redirectUrl.searchParams.set('error_description', errorDescription);
    }
    return NextResponse.redirect(redirectUrl.toString());
  }

  if (code) {
    const redirectTarget = `${baseUrl}${safeNext}`;
    const response = NextResponse.redirect(redirectTarget);

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    });

    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError && data?.user) {
      await syncUserProfile(data.user);
      return response;
    }

    if (exchangeError) {
      console.error('Supabase Auth callback session exchange error:', exchangeError.message);
      const redirectUrl = new URL(`${baseUrl}/login`);
      redirectUrl.searchParams.set('error', 'session_exchange_failed');
      redirectUrl.searchParams.set('error_description', exchangeError.message);
      return NextResponse.redirect(redirectUrl.toString());
    }
  }

  // Missing authorization code
  return NextResponse.redirect(`${baseUrl}/login?error=missing_code`);
}
