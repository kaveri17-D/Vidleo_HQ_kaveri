import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { syncUserProfile } from '@/lib/supabase/profile';
import { getSiteUrl } from '@/lib/siteUrl';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');
  const next = requestUrl.searchParams.get('next') || '/dashboard';
  const baseUrl = getSiteUrl();

  // Normalize next parameter to prevent open redirect vulnerabilities
  const safeNext = next.startsWith('/') ? next : `/${next}`;

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
    const supabase = createClient();
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError && data?.user) {
      await syncUserProfile(data.user);
      return NextResponse.redirect(`${baseUrl}${safeNext}`);
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
