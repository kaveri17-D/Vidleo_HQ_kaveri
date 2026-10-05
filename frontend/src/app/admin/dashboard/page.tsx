'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Film, 
  Download, 
  Activity, 
  CheckCircle2, 
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Globe,
  Radio,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface OverviewStats {
  totalUsers: number | null;
  activeUsers: number | null;
  totalDownloads: number | null;
  successfulDownloads: number | null;
  failedDownloads: number | null;
  activeJobs: number | null;
  providerCounts?: Record<string, number>;
  systemStatus: string;
  lastUpdated?: string;
}

export default function AdminDashboardOverviewPage() {
  const [stats, setStats] = useState<OverviewStats>({
    totalUsers: null,
    activeUsers: null,
    totalDownloads: null,
    successfulDownloads: null,
    failedDownloads: null,
    activeJobs: null,
    providerCounts: {},
    systemStatus: 'Checking...',
  });
  const [loading, setLoading] = useState(true);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=overview', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      } else {
        setStats((prev) => ({ ...prev, systemStatus: 'Unavailable' }));
      }
    } catch {
      setStats((prev) => ({ ...prev, systemStatus: 'Unavailable' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const formatStat = (val: number | null | undefined) => {
    if (loading) return '...';
    if (val === null || val === undefined) return '0';
    return val.toLocaleString();
  };

  return (
    <div className="space-y-8 text-white font-sans">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
              Admin Overview
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-[#5B4BFF]/20 border border-[#5B4BFF]/40 text-[#5B4BFF] text-[10px] font-mono font-bold uppercase">
              Live Engine Control
            </span>
          </div>
          <p className="text-xs text-white/60 pt-1">
            Real-time infrastructure health, user database records, and active extraction jobs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchOverview}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Overview</span>
          </button>
          <a
            href="/admin/system"
            className="px-3.5 py-1.5 rounded-xl bg-[#5B4BFF]/20 hover:bg-[#5B4BFF]/30 border border-[#5B4BFF]/40 text-xs font-semibold text-[#5B4BFF] transition-all flex items-center gap-1.5"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Diagnostics</span>
          </a>
        </div>
      </div>

      {/* Primary 6 Core Requirement Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Total Users */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
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
              {formatStat(stats.totalUsers)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Database: Supabase public.user_roles
            </p>
          </div>
        </div>

        {/* 2. Active Users */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Active Users
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-white font-display">
              {formatStat(stats.activeUsers)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Verified accounts with active privileges
            </p>
          </div>
        </div>

        {/* 3. Total Downloads */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Total Downloads
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-white font-display">
              {formatStat(stats.totalDownloads)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              FastAPI engine cumulative download jobs
            </p>
          </div>
        </div>

        {/* 4. Successful Downloads */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Successful Downloads
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-emerald-400 font-display">
              {formatStat(stats.successfulDownloads)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Completed media extractions
            </p>
          </div>
        </div>

        {/* 5. Failed Downloads */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Failed Downloads
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-amber-400 font-display">
              {formatStat(stats.failedDownloads)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Upstream rejections & timeout events
            </p>
          </div>
        </div>

        {/* 6. Current / Active Jobs */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Active Jobs
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-blue-400 font-display">
              {formatStat(stats.activeJobs)}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Currently processing in job runner
            </p>
          </div>
        </div>
      </div>

      {/* Backend Engine Statistics (Only Real Backend Data) */}
      <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#5B4BFF]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/80 font-mono">
              Live Provider Telemetry (Backend /api/health)
            </h2>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {stats.systemStatus}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {stats.providerCounts && Object.keys(stats.providerCounts).length > 0 ? (
            Object.entries(stats.providerCounts).map(([provider, count]) => (
              <div key={provider} className="p-3.5 rounded-xl bg-white/[0.04] border border-white/5 space-y-1">
                <span className="text-[11px] font-mono uppercase text-white/40 block truncate">{provider}</span>
                <span className="text-base font-extrabold text-white font-mono">{count} requests</span>
              </div>
            ))
          ) : (
            <div className="col-span-4 py-4 text-center text-xs text-white/40 font-mono">
              No provider requests registered in current engine cycle.
            </div>
          )}
        </div>
      </div>

      {/* Operational Sections Quick Access */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <a
          href="/admin/dashboard/users"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-[#5B4BFF]/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-[#5B4BFF] transition-colors">
                Users Directory
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Query registered users in public.user_roles, inspect account details, and manage roles.
            </p>
          </div>
        </a>

        <a
          href="/admin/dashboard/downloads"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-indigo-500/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Download className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-indigo-400 transition-colors">
                Downloads Log
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Inspect database download records, job IDs, URLs, and delivery statuses.
            </p>
          </div>
        </a>

        <a
          href="/admin/dashboard/jobs"
          className="p-6 rounded-2xl bg-[#12121A] border border-white/10 hover:border-blue-500/50 transition-all group space-y-3"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Film className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition-colors">
                Job Monitoring
              </h3>
              <ArrowUpRight className="w-4 h-4 text-white/40 group-hover:text-white transition-all" />
            </div>
            <p className="text-xs text-white/60">
              Live monitor for queued, processing, completed, and failed media extraction jobs.
            </p>
          </div>
        </a>
      </div>
    </div>
  );
}
