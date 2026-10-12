import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Handled if called from Server Component
        }
      },
    },
  });
}
