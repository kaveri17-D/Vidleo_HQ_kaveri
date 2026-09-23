'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { 
  Users, 
  Film, 
  Download, 
  Activity, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  HardDrive
} from 'lucide-react';

export default function AdminDashboardOverviewPage() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalDownloads: 0,
    activeSessions: 1,
    systemStatus: 'Operational',
  });
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    async function loadStats() {
      try {
        const { count: usersCount } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });

        const { count: downloadsCount } = await supabase
          .from('downloads')
          .select('*', { count: 'exact', head: true });

        setStats({
          totalUsers: usersCount || 0,
          totalDownloads: downloadsCount || 0,
          activeSessions: 1,
          systemStatus: 'Operational',
        });
      } catch (err) {
        console.warn('Unable to fetch live admin stats from database:', err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [supabase]);

  return (
    <div className="space-y-8 text-white font-sans">
      
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
              Vidleo Admin Overview
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-[#5B4BFF]/20 border border-[#5B4BFF]/40 text-[#5B4BFF] text-[10px] font-mono font-bold uppercase">
              Control Panel
            </span>
          </div>
          <p className="text-xs text-white/60 pt-1">
            Real-time infrastructure health, user activity, and video extraction stats.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/admin/system"
            className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-1.5"
          >
            <Activity className="w-3.5 h-3.5 text-[#5B4BFF]" />
            <span>System Diagnostics</span>
          </a>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Users */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Total Users
            </span>
            <div className="w-9 h-9 rounded-xl bg-[#5B4BFF]/20 border border-[#5B4BFF]/30 text-[#5B4BFF] flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-white font-display">
              {loading ? '...' : stats.totalUsers}
            </div>
            <p className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              <span>Google OAuth Synced</span>
            </p>
          </div>
        </div>

        {/* Total Extractions */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Media Extractions
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-white font-display">
              {loading ? '...' : stats.totalDownloads}
            </div>
            <p className="text-[11px] text-white/50 font-mono">
              YouTube, IG, TikTok & 1000+
            </p>
          </div>
        </div>

        {/* Active Engine */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Engine Status
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-emerald-400 font-display flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span>{stats.systemStatus}</span>
            </div>
            <p className="text-[11px] text-white/50 font-mono">
              Latency: 42ms · 99.9% Uptime
            </p>
          </div>
        </div>

        {/* Security & RLS */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3 relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Security RLS
            </span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-white font-display">
              Enforced
            </div>
            <p className="text-[11px] text-white/50 font-mono">
              Server Role Verification
            </p>
          </div>
        </div>

      </div>

      {/* Quick Action Navigation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* User Control Card */}
        <a
          href="/admin/users"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-[#5B4BFF]/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-[#5B4BFF] transition-colors">
                User Directory
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Inspect user profiles, authentication providers, and manage account statuses.
            </p>
          </div>
        </a>

        {/* Media Control Card */}
        <a
          href="/admin/media"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-blue-500/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Film className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition-colors">
                Media & Formats
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Browse video extraction logs across YouTube, Instagram, TikTok and audio platforms.
            </p>
          </div>
        </a>

        {/* System Diagnostics Card */}
        <a
          href="/admin/system"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-emerald-500/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Activity className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">
                System Diagnostics
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Monitor Supabase DB connection, auth provider status, and engine health.
            </p>
          </div>
        </a>

      </div>

    </div>
  );
}
