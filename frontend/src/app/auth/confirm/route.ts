import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
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

function sanitizeNextPath(rawNext: string | null): string {
  if (!rawNext) return '/dashboard';
  const trimmed = rawNext.trim();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('://') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
  ) {
    return '/dashboard';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const rawNext = requestUrl.searchParams.get('next');
  const safeNext = sanitizeNextPath(rawNext);
  const baseUrl = getSiteUrl();

  if (token_hash && type) {
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

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (!error && data?.user) {
      await syncUserProfile(data.user);
      return response;
    }

    if (error) {
      console.error('Supabase Auth confirm verifyOtp error:', error.message);
      const redirectUrl = new URL(`${baseUrl}/login`);
      redirectUrl.searchParams.set('error', 'email_verification_failed');
      redirectUrl.searchParams.set('error_description', error.message);
      return NextResponse.redirect(redirectUrl.toString());
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=invalid_verification_link`);
}
