import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

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

let browserClient: SupabaseClient | null = null;

export function createClient() {
  if (typeof window === 'undefined') {
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  return browserClient;
}
