import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Ensures the authenticated user's profile exists in the database 'profiles' table.
 * Safe against missing tables or network errors.
 */
export async function syncUserProfile(user: User): Promise<UserProfile | null> {
  if (!user) return null;

  const profileData: UserProfile = {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Vidleo User',
    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
    updated_at: new Date().toISOString(),
  };

  try {
    const supabase = createClient();
    
    // Attempt upsert into profiles table if table exists
    const { error } = await supabase
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (error) {
      // Log silently in dev, table might not be migrated yet in Supabase Dashboard
      console.warn('Profile sync warning (Supabase table profiles may require creation):', error.message);
    }
  } catch (err) {
    console.warn('Unable to sync profile:', err);
  }

  return profileData;
}
