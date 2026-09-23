import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { syncUserProfile } from '@/lib/supabase/profile';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/dashboard';
  const origin = requestUrl.origin;

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.user) {
      await syncUserProfile(data.user);
      return NextResponse.redirect(`${origin}${next}`);
    }

    if (error) {
      console.error('Supabase Auth callback session exchange error:', error.message);
    }
  }

  // Redirect to login page with clean error query param
  return NextResponse.redirect(`${origin}/login?error=authentication_failed`);
}
