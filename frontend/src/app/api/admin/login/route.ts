import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { verifyAdminUser } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = body?.email?.trim();
    const password = body?.password;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Invalid admin credentials' },
        { status: 400 }
      );
    }

    // Set up cookie response container
    const response = NextResponse.json({ success: true, redirectUrl: '/admin/dashboard' });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    });

    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: 'Invalid admin credentials' },
        { status: 401 }
      );
    }

    // 2. Strict Server-Side Role Verification
    const verification = await verifyAdminUser(supabase);

    if (!verification.isAdmin) {
      // Disallow non-admin user sessions: sign out immediately
      await supabase.auth.signOut();
      
      // Clear session cookies in response
      const clearResponse = NextResponse.json(
        { error: 'Invalid admin credentials' },
        { status: 401 }
      );
      
      request.cookies.getAll().forEach((cookie) => {
        if (cookie.name.startsWith('sb-')) {
          clearResponse.cookies.set({ name: cookie.name, value: '', maxAge: 0, path: '/' });
        }
      });

      return clearResponse;
    }

    return response;
  } catch (err) {
    console.error('Admin login error:', err);
    return NextResponse.json(
      { error: 'Invalid admin credentials' },
      { status: 500 }
    );
  }
}
