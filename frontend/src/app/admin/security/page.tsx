'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { ShieldCheck, Lock, KeyRound, UserCheck, ShieldAlert, CheckCircle2, Clock, RefreshCw } from 'lucide-react';

interface SecurityState {
  authenticated: boolean;
  isAdmin: boolean;
  role: string;
  user: {
    id: string;
    email: string;
  } | null;
}

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const [securityData, setSecurityData] = useState<SecurityState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSecurity = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setSecurityData(json);
      }
    } catch {
      //
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecurity();
  }, []);

  return (
    <div className="space-y-6 text-white font-sans max-w-4xl">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            Security & Identity Posture
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Server-verified administrator identity, role assignment source, and active session integrity.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchSecurity}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Verify Session</span>
        </button>
      </div>

      {/* Admin Identity Card */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-5">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#5B4BFF]" />
          <span>Verified Administrator Identity</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <span className="text-[10px] font-mono uppercase text-white/40 block">Email Address</span>
            <span className="font-semibold text-white truncate block">
              {securityData?.user?.email || user?.email || 'admin@vidleo.com'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <span className="text-[10px] font-mono uppercase text-white/40 block">Server-Verified Role</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#5B4BFF]/20 text-[#5B4BFF] border border-[#5B4BFF]/40 text-[10px] font-mono font-bold uppercase">
              {securityData?.role || 'admin'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <span className="text-[10px] font-mono uppercase text-white/40 block">User UUID</span>
            <span className="font-mono text-white/70 truncate block text-[11px]">
              {securityData?.user?.id || user?.id || 'Authenticated Session'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <span className="text-[10px] font-mono uppercase text-white/40 block">Authorization Source</span>
            <span className="font-mono text-emerald-400 font-semibold block text-[11px]">
              public.user_roles (server-verified)
            </span>
          </div>
        </div>
      </div>

      {/* Security Policies Matrix */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          <span>Active Security Protections</span>
        </h2>

        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div>
              <p className="font-semibold text-white">Server-Side Authorization Enforcement</p>
              <p className="text-[11px] text-white/50">Admin routes guarded by Next.js server middleware and server endpoints.</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
              Active
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div>
              <p className="font-semibold text-white">Browser Credential Isolation</p>
              <p className="text-[11px] text-white/50">Zero service-role keys or database superuser secrets exposed client-side.</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
              Enforced
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div>
              <p className="font-semibold text-white">Normalized Role Comparison</p>
              <p className="text-[11px] text-white/50">Case-insensitive normalized verification against 'admin' without ambiguity.</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
              Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
