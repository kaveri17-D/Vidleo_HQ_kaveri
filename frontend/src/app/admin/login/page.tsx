'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  ShieldAlert, 
  Lock, 
  Mail, 
  ArrowLeft, 
  Loader2, 
  KeyRound, 
  ShieldCheck,
} from 'lucide-react';
import { Suspense } from 'react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'access_denied') {
      setErrorMessage('Invalid admin credentials');
    }
  }, [searchParams]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setErrorMessage(data?.error || 'Invalid admin credentials');
        setLoading(false);
        return;
      }

      // Successful admin authentication -> redirect to /admin/dashboard
      const next = searchParams.get('next') || '/admin/dashboard';
      router.replace(next);
      router.refresh();
    } catch (err: any) {
      setErrorMessage('Invalid admin credentials');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0E] text-white flex flex-col justify-between selection:bg-[#5B4BFF] selection:text-white font-sans antialiased relative overflow-hidden">
      
      {/* Background Ambient Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-tr from-[#5B4BFF]/20 via-[#A855F7]/15 to-[#388BFD]/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Top Bar */}
      <header className="px-6 sm:px-10 py-6 flex items-center justify-between border-b border-white/[0.08] bg-[#0A0A0E]/80 backdrop-blur-md">
        <a href="/" className="inline-flex items-center gap-2 group">
          <VidleoLogo size="md" isLight={false} />
          <span className="text-[#5B4BFF] font-mono text-xs font-semibold uppercase px-2 py-0.5 rounded-full bg-[#5B4BFF]/20 border border-[#5B4BFF]/30">
            Admin
          </span>
        </a>

        <a
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Exit to Main Site</span>
        </a>
      </header>

      {/* Main Login Form */}
      <main className="flex-1 flex items-center justify-center px-4 py-12 z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-[420px] bg-[#12121A] border border-white/[0.12] rounded-[28px] p-7 sm:p-9 shadow-[0_25px_60px_rgba(0,0,0,0.6)] relative"
        >
          {/* Header Title */}
          <div className="text-center space-y-2 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#5B4BFF]/20 border border-[#5B4BFF]/40 text-[#5B4BFF] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#5B4BFF]/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
              Administrator Login
            </h1>
            <p className="text-xs text-white/60 font-sans leading-relaxed">
              Enter your privileged credentials to access the Vidleo Admin Dashboard.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5 shadow-2xs"
            >
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-tight font-medium">
                {errorMessage}
              </div>
            </motion.div>
          )}

          {/* Login Form */}
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-[11px] font-mono font-semibold text-white/70 uppercase tracking-wider mb-2">
                Admin Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@vidleo.com"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/30 text-xs font-medium focus:outline-none focus:border-[#5B4BFF] focus:ring-1 focus:ring-[#5B4BFF] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono font-semibold text-white/70 uppercase tracking-wider mb-2">
                Admin Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/30 text-xs font-medium focus:outline-none focus:border-[#5B4BFF] focus:ring-1 focus:ring-[#5B4BFF] transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 mt-2 rounded-xl bg-[#5B4BFF] hover:bg-[#4d3df7] active:scale-[0.99] text-white text-xs font-bold font-mono uppercase tracking-wider transition-all shadow-lg shadow-[#5B4BFF]/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Privileges...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Login</span>
                </>
              )}
            </button>
          </form>

          {/* Secure Environment Notice */}
          <div className="mt-8 pt-6 border-t border-white/[0.08] text-center">
            <p className="text-[11px] text-white/40 font-mono flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Zero-Trust Server Enforcement Active</span>
            </p>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 text-center border-t border-white/[0.06] text-[11px] text-white/40 font-mono">
        Vidleo Platform &copy; {new Date().getFullYear()} &bull; Strictly for Authorized Administrators
      </footer>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0A0A0E] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#5B4BFF] animate-spin" />
      </div>
    }>
      <AdminLoginForm />
    </Suspense>
  );
}
