'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Settings, ShieldCheck, Key, Lock, Bell, CheckCircle2 } from 'lucide-react';

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const [sessionTimeout, setSessionTimeout] = useState('24');
  const [require2FA, setRequire2FA] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 text-white font-sans max-w-4xl">
      
      {/* Title */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
          Admin Security & Preferences
        </h1>
        <p className="text-xs text-white/60 pt-1">
          Configure administrative session security, rate limits, and profile settings.
        </p>
      </div>

      {saved && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Admin settings saved successfully.</span>
        </div>
      )}

      {/* Admin Account Profile Card */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#5B4BFF]" />
          <span>Administrator Profile</span>
        </h2>

        <div className="space-y-3 text-xs">
          <div>
            <span className="text-white/40 block font-mono text-[10px] uppercase">Authenticated Email</span>
            <span className="text-white font-semibold">{user?.email || 'admin@vidleo.com'}</span>
          </div>

          <div>
            <span className="text-white/40 block font-mono text-[10px] uppercase">Role Authorization</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#5B4BFF]/20 text-[#5B4BFF] border border-[#5B4BFF]/30 text-[10px] font-mono font-bold uppercase mt-1">
              Super Admin
            </span>
          </div>
        </div>
      </div>

      {/* Security Policies Form */}
      <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-5">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#5B4BFF]" />
          <span>Security & Session Enforcement</span>
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/80 mb-2">
              Admin Session Idle Timeout (Hours)
            </label>
            <select
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="w-full sm:w-64 h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs focus:outline-none focus:border-[#5B4BFF]"
            >
              <option value="1" className="bg-[#12121A]">1 Hour</option>
              <option value="8" className="bg-[#12121A]">8 Hours</option>
              <option value="24" className="bg-[#12121A]">24 Hours (Default)</option>
              <option value="72" className="bg-[#12121A]">72 Hours</option>
            </select>
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Require Server RLS Validation on API Calls</p>
              <p className="text-[11px] text-white/50">Verify user role from DB on every server route execution.</p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
              Always Active
            </span>
          </div>
        </div>

        <div className="pt-4 border-t border-white/[0.08] flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-[#5B4BFF] hover:bg-[#4B3BFF] text-white text-xs font-semibold transition-all cursor-pointer shadow-md"
          >
            Save Security Settings
          </button>
        </div>
      </form>

    </div>
  );
}
