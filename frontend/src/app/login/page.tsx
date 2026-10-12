'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/components/providers/AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, AlertCircle, Loader2, ShieldCheck, Zap, Mail, Lock } from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';
import { getSiteUrl } from '@/lib/siteUrl';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleConnecting, setIsGoogleConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check searchParams and hash for auth errors
  useEffect(() => {
    const errorParam = searchParams.get('error');
    const descParam = searchParams.get('error_description');
    const verifiedParam = searchParams.get('verified');
    
    if (verifiedParam === 'true') {
      setSuccessMessage('Email verified successfully! Please sign in with your email and password below.');
      setMode('signin');
      return;
    }

    if (errorParam === 'authentication_failed') {
      setErrorMessage('Sign-in was unsuccessful. Please check your credentials or try again.');
    } else if (errorParam === 'invalid_request' && descParam?.includes('flow_state_already_used')) {
      setErrorMessage('This verification or sign-in link has already been used. Please sign in with your email and password below.');
    } else if (descParam?.includes('code_verifier') || descParam?.includes('auth_code')) {
      setSuccessMessage('Your email verification was processed. Please sign in with your email and password below.');
      setMode('signin');
    } else if (descParam) {
      setErrorMessage(descParam);
    } else if (errorParam) {
      setErrorMessage('Authentication error occurred. Please try signing in again.');
    }

    // Check for hash parameters in browser (e.g. #error=access_denied&error_code=...)
    if (typeof window !== 'undefined' && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const hashError = hashParams.get('error');
      const hashDesc = hashParams.get('error_description');
      const hashErrorCode = hashParams.get('error_code');

      if (hashErrorCode === 'flow_state_already_used' || hashDesc?.includes('already been used')) {
        setErrorMessage('This verification link has already been used. Please sign in below.');
      } else if (hashDesc) {
        setErrorMessage(decodeURIComponent(hashDesc).replace(/\+/g, ' '));
      } else if (hashError) {
        setErrorMessage(decodeURIComponent(hashError).replace(/\+/g, ' '));
      }
    }
  }, [searchParams]);

  // Redirect authenticated user to destination
  useEffect(() => {
    if (!authLoading && user) {
      const next = searchParams.get('next') || '/dashboard';
      window.location.href = next;
    }
  }, [user, authLoading, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = createClient();
      const baseUrl = getSiteUrl();

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || undefined,
            },
            emailRedirectTo: `${baseUrl}/auth/confirm`,
          },
        });

        if (error) {
          setErrorMessage(error.message || 'Failed to create account.');
          setIsLoading(false);
          return;
        }

        if (data?.session) {
          const next = searchParams.get('next') || '/dashboard';
          window.location.href = next;
        } else if (data?.user) {
          setSuccessMessage('Account created! If email confirmation is required, please check your inbox to confirm your address before logging in.');
          setIsLoading(false);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          if (error.message?.toLowerCase().includes('email not confirmed')) {
            setErrorMessage('Your email address has not been confirmed yet. Please verify your email via the confirmation link or contact support.');
          } else {
            setErrorMessage(error.message || 'Invalid email or password.');
          }
          setIsLoading(false);
          return;
        }

        if (data?.session) {
          const next = searchParams.get('next') || '/dashboard';
          window.location.href = next;
        }
      }
    } catch (err: any) {
      setErrorMessage('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleConnecting) return;
    setIsGoogleConnecting(true);
    setErrorMessage(null);

    try {
      const next = searchParams.get('next') || '/dashboard';
      const baseUrl = getSiteUrl();
      const redirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`;

      const { error } = await signInWithGoogle(redirectTo);
      if (error) {
        if (error.message?.includes('provider is not enabled')) {
          setErrorMessage('Google OAuth is not currently enabled in the Supabase project configuration. Please use email and password to sign in or create an account.');
        } else {
          setErrorMessage(error.message || 'Failed to initiate Google authentication.');
        }
        setIsGoogleConnecting(false);
      }
    } catch (err: any) {
      setErrorMessage('Google sign-in encountered an error. Please try again.');
      setIsGoogleConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex flex-col justify-between selection:bg-[#0A0A0C] selection:text-white font-sans antialiased relative overflow-hidden dot-grid-light">
      
      {/* Background Decorative Blur Orbs */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-[#5B4BFF]/10 via-[#388BFD]/10 to-[#65F27C]/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Top Header Navigation */}
      <header className="px-6 sm:px-10 py-6 flex items-center justify-between z-20">
        <a
          href="/"
          className="inline-flex items-center gap-2 group cursor-pointer"
          aria-label="Vidleo homepage"
        >
          <VidleoLogo size="md" />
        </a>

        <a
          href="/"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-black/[0.08] text-xs font-semibold text-[#5A5A62] hover:text-[#0A0A0C] hover:border-black/20 shadow-2xs transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </a>
      </header>

      {/* Main Login Card Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-12 z-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[440px] bg-white border border-black/[0.08] rounded-[28px] p-7 sm:p-9 shadow-[0_20px_50px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)] relative"
        >
          {/* Header Title */}
          <div className="text-center space-y-2 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#F0EEFF] border border-[#D5D0FF] text-[#5B4BFF] flex items-center justify-center mx-auto mb-4 shadow-sm">
              <Zap className="w-6 h-6 fill-[#5B4BFF]/20" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0A0A0C] font-display">
              Welcome to Vidleo
            </h1>
            <p className="text-xs text-[#5A5A62] leading-relaxed max-w-xs mx-auto font-sans">
              Sign in to access high-speed video extraction, media library, and personal download history.
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex rounded-xl bg-[#F0EFF4] p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'signin'
                  ? 'bg-white text-[#0A0A0C] shadow-2xs'
                  : 'text-[#6A6A74] hover:text-[#0A0A0C]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'signup'
                  ? 'bg-white text-[#0A0A0C] shadow-2xs'
                  : 'text-[#6A6A74] hover:text-[#0A0A0C]'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Success Banner */}
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5 shadow-2xs"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-tight font-medium">
                {successMessage}
              </div>
            </motion.div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5 shadow-2xs"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-tight font-medium">
                {errorMessage}
              </div>
            </motion.div>
          )}

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5 mb-5">
            {mode === 'signup' && (
              <div>
                <label className="block text-[11px] font-semibold text-[#5A5A62] mb-1.5 uppercase tracking-wider">
                  Full Name (Optional)
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your Name"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F6F6F8] border border-black/[0.08] text-xs text-[#0A0A0C] placeholder:text-[#8E8E98] focus:outline-none focus:border-[#5B4BFF] focus:bg-white transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-[#5A5A62] mb-1.5 uppercase tracking-wider">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8E8E98] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-[#F6F6F8] border border-black/[0.08] text-xs text-[#0A0A0C] placeholder:text-[#8E8E98] focus:outline-none focus:border-[#5B4BFF] focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#5A5A62] mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8E8E98] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-[#F6F6F8] border border-black/[0.08] text-xs text-[#0A0A0C] placeholder:text-[#8E8E98] focus:outline-none focus:border-[#5B4BFF] focus:bg-white transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || authLoading}
              className="w-full h-11 rounded-xl bg-[#0A0A0C] hover:bg-black text-white text-[13px] font-semibold tracking-wide transition-all duration-150 flex items-center justify-center gap-2 shadow-sm hover:shadow-md active:scale-[0.99] disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                  <span>{mode === 'signup' ? 'Creating account...' : 'Signing in...'}</span>
                </>
              ) : (
                <span>{mode === 'signup' ? 'Create Account' : 'Sign In with Email'}</span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-black/[0.08]" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest text-[#8E8E98]">
              <span className="bg-white px-3">or continue with</span>
            </div>
          </div>

          {/* Google Auth Action Button */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleConnecting || authLoading}
              className="w-full h-11 rounded-xl bg-white hover:bg-[#FAF9FC] border border-[#DCDCE2] hover:border-black/30 text-[#0A0A0C] text-[13px] font-semibold tracking-tight transition-all duration-150 flex items-center justify-center gap-3 shadow-[0_2px_6px_rgba(0,0,0,0.04)] hover:shadow-md active:scale-[0.99] disabled:opacity-75 disabled:cursor-not-allowed group cursor-pointer"
            >
              {isGoogleConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 text-[#5B4BFF] animate-spin" />
                  <span>Connecting to Google...</span>
                </>
              ) : (
                <>
                  {/* Google SVG Official Icon */}
                  <svg className="w-4 h-4 shrink-0 group-hover:scale-105 transition-transform" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.29v3.15C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.29C.47 8.21 0 10.05 0 12s.47 3.79 1.29 5.42l3.99-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.58l3.99 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                  <span>Google</span>
                </>
              )}
            </button>

            <div className="pt-2 text-center space-y-2">
              <p className="text-[11px] text-[#8E8E98] leading-relaxed">
                By continuing, you agree to Vidleo's{' '}
                <a href="/terms" className="underline hover:text-black">Terms of Service</a>{' '}
                and{' '}
                <a href="/privacy" className="underline hover:text-black">Privacy Policy</a>.
              </p>
              <div>
                <a
                  href="/admin/login"
                  className="text-[11px] text-[#8E8E98] hover:text-[#5B4BFF] transition-colors"
                >
                  Administrator? Sign in
                </a>
              </div>
            </div>
          </div>

          {/* Security Badge */}
          <div className="mt-8 pt-5 border-t border-black/[0.06] flex items-center justify-center gap-2 text-[11px] font-medium text-[#5A5A62]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Encrypted OAuth 2.0 PKCE & SSL Authentication</span>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-[#8E8E98] z-20">
        © {new Date().getFullYear()} Vidleo. Powered by Synapvo Tech.
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] flex items-center justify-center font-sans text-xs text-[#5A5A62]">
          Loading sign in...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
