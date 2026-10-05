'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { syncUserProfile } from '@/lib/supabase/profile';
import { getSiteUrl } from '@/lib/siteUrl';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: (redirectTo?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signInWithGoogle: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let isMounted = true;

    async function getInitialSession() {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (isMounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
          if (initialSession?.user) {
            syncUserProfile(initialSession.user);
          }
        }
      } catch (err) {
        console.error('Failed to retrieve initial auth session:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        if (isMounted) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          setLoading(false);

          if (currentSession?.user) {
            syncUserProfile(currentSession.user);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithGoogle = useCallback(
    async (customRedirectTo?: string) => {
      try {
        const baseUrl = getSiteUrl();
        const redirectTo = customRedirectTo || `${baseUrl}/auth/callback`;

        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
          },
        });

        if (error) {
          return { error };
        }
        return { error: null };
      } catch (err: any) {
        return { error: err || new Error('Google sign-in failed') };
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, [supabase]);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signInWithGoogle,
      signOut,
    }),
    [user, session, loading, signInWithGoogle, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
