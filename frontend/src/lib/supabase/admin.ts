import { SupabaseClient, User } from '@supabase/supabase-js';

export interface AdminVerificationResult {
  isAdmin: boolean;
  user: User | null;
  role: string;
}

/**
 * Normalizes a role string to lowercase trimmed format.
 */
export function normalizeRole(role: unknown): string {
  if (typeof role !== 'string') return '';
  return role.trim().toLowerCase();
}

/**
 * Server-side function to verify if the current user is an authenticated Admin.
 * Primary source of truth: public.user_roles (user_id, role)
 * Secondary source of truth: secure Supabase auth metadata.
 */
export async function verifyAdminUser(supabase: SupabaseClient): Promise<AdminVerificationResult> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { isAdmin: false, user: null, role: 'unauthenticated' };
    }

    // 1. Primary Source of Truth: public.user_roles (user_id -> role)
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!roleError && roleData?.role) {
      const normalizedRole = normalizeRole(roleData.role);
      if (normalizedRole === 'admin') {
        return { isAdmin: true, user, role: 'admin' };
      }
    }

    // 2. Secondary check: Auth metadata (app_metadata or user_metadata)
    const appRole = normalizeRole(user.app_metadata?.role);
    const userRole = normalizeRole(user.user_metadata?.role);

    if (appRole === 'admin' || userRole === 'admin') {
      return { isAdmin: true, user, role: 'admin' };
    }

    // 3. Fallback: Check if user email matches developer initial admin email
    const devAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    if (devAdminEmail && user.email?.trim().toLowerCase() === devAdminEmail) {
      return { isAdmin: true, user, role: 'admin' };
    }

    const determinedRole = normalizeRole(roleData?.role) || appRole || userRole || 'user';
    return { isAdmin: false, user, role: determinedRole };
  } catch (err) {
    console.error('Admin verification error:', err);
    return { isAdmin: false, user: null, role: 'error' };
  }
}
