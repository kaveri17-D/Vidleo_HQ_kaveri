import { SupabaseClient, User } from '@supabase/supabase-js';

export interface AdminVerificationResult {
  isAdmin: boolean;
  user: User | null;
  role: string;
}

/**
 * Server-side function to verify if the current user is an authenticated Admin.
 * Checks app_metadata, user_metadata, user_roles table, and profiles table.
 */
export async function verifyAdminUser(supabase: SupabaseClient): Promise<AdminVerificationResult> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { isAdmin: false, user: null, role: 'unauthenticated' };
    }

    // 1. Check Auth Metadata (app_metadata or user_metadata)
    const appRole = user.app_metadata?.role;
    const userRole = user.user_metadata?.role;

    if (appRole === 'admin' || userRole === 'admin') {
      return { isAdmin: true, user, role: 'admin' };
    }

    // 2. Check user_roles table
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (roleData?.role === 'admin') {
      return { isAdmin: true, user, role: 'admin' };
    }

    // 3. Check profiles table role column
    const { data: profileData } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileData?.role === 'admin') {
      return { isAdmin: true, user, role: 'admin' };
    }

    // Fallback: Check if user email matches developer fallback when initial environment is set
    const devAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
    if (devAdminEmail && user.email?.toLowerCase() === devAdminEmail.toLowerCase()) {
      return { isAdmin: true, user, role: 'admin' };
    }

    return { isAdmin: false, user, role: 'user' };
  } catch (err) {
    console.error('Admin verification error:', err);
    return { isAdmin: false, user: null, role: 'error' };
  }
}
