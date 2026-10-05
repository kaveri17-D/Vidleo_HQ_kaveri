'use client';

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Radio, 
  Film,
  Server,
  Loader2
} from 'lucide-react';

interface JobCounts {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

interface JobsData {
  counts: JobCounts;
  systemStatus: string;
  recentJobs: any[];
  lastUpdated: string;
}

export default function AdminJobsDashboardPage() {
  const [data, setData] = useState<JobsData>({
    counts: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
    systemStatus: 'Checking...',
    recentJobs: [],
    lastUpdated: '',
  });
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=jobs', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="space-y-8 text-white font-sans">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
              Job Monitoring & Queue Stream
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-400 text-[10px] font-mono font-bold uppercase">
              Engine Runner Status
            </span>
          </div>
          <p className="text-xs text-white/60 pt-1">
            Real-time tracking of queued, downloading, completed, and failed media extraction jobs.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchJobs}
          disabled={loading}
          className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Jobs</span>
        </button>
      </div>

      {/* 4 Core Job Categories */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Queued Jobs */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Queued Jobs
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-amber-400 font-display">
              {loading ? '...' : data.counts.queued}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Awaiting worker allocation
            </p>
          </div>
        </div>

        {/* 2. Processing Jobs */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Processing Jobs
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-blue-400 font-display">
              {loading ? '...' : data.counts.processing}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              In-flight active extraction
            </p>
          </div>
        </div>

        {/* 3. Completed Jobs */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Completed Jobs
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-emerald-400 font-display">
              {loading ? '...' : data.counts.completed}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Successfully delivered streams
            </p>
          </div>
        </div>

        {/* 4. Failed Jobs */}
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold uppercase text-white/50 tracking-wider">
              Failed Jobs
            </span>
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-extrabold tracking-tight text-rose-400 font-display">
              {loading ? '...' : data.counts.failed}
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Upstream extractor errors
            </p>
          </div>
        </div>
      </div>

      {/* Engine Status Banner */}
      <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">FastAPI Media Extraction Engine</h3>
            <p className="text-xs text-white/50 font-mono">Status: {data.systemStatus} &bull; Port: 8000</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-white/40 font-mono block">
            Total Jobs Handled: {loading ? '...' : data.counts.total}
          </span>
          {data.lastUpdated && (
            <span className="text-[10px] text-white/30 font-mono block">
              Updated: {new Date(data.lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Active Jobs Stream */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white/90 font-mono uppercase tracking-wider">
            Active Job Stream
          </h2>
          <span className="text-[11px] font-mono text-white/40">
            {data.counts.processing} active in flight
          </span>
        </div>

        {data.counts.processing === 0 ? (
          <div className="py-16 text-center text-white/40">
            <Film className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="font-bold text-white/70 text-sm mb-1">No active extraction jobs in-flight</p>
            <p className="text-xs text-white/40 font-mono max-w-sm mx-auto">
              When a user initiates an extraction or download from the Vidleo UI, real-time stage progress and speeds will populate here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.recentJobs.map((job: any) => (
              <div key={job.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-white font-bold">{job.id}</span>
                  <span className="text-xs text-white/60 block">{job.url}</span>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 font-mono text-xs">
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
