'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, RefreshCw, Calendar, PieChart, Activity } from 'lucide-react';

interface MetricSnapshot {
  totalUsers: number;
  totalExtractions: number;
  successfulExtractions: number;
  failedExtractions: number;
  totalDownloads: number;
  apiRequests: number;
}

export default function AdminAnalyticsPage() {
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=overview', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch {
      //
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const hasData = (metrics?.totalExtractions ?? 0) > 0 || (metrics?.totalUsers ?? 0) > 0;

  return (
    <div className="space-y-6 text-white font-sans max-w-5xl">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            Operational Analytics
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Aggregated system metrics derived directly from Supabase and extraction engine records.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAnalytics}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Time Range Filter */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-4">
        <Calendar className="w-4 h-4 text-white/40 mr-1" />
        {[
          { label: 'Last 7 Days', value: '7d' },
          { label: 'Last 30 Days', value: '30d' },
          { label: 'All Time', value: 'all' },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTimeRange(t.value as any)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              timeRange === t.value
                ? 'bg-[#5B4BFF] text-white shadow-md'
                : 'bg-white/[0.05] text-white/60 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Real Metric Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-2">
          <span className="text-xs font-mono uppercase text-white/50">Extractions</span>
          <div className="text-2xl font-extrabold text-white">
            {loading ? '...' : (metrics?.totalExtractions ?? 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-white/40 font-mono">Total requested jobs</p>
        </div>

        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-2">
          <span className="text-xs font-mono uppercase text-white/50">Successful</span>
          <div className="text-2xl font-extrabold text-emerald-400">
            {loading ? '...' : (metrics?.successfulExtractions ?? 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-white/40 font-mono">Completed extractions</p>
        </div>

        <div className="p-5 rounded-2xl bg-[#12121A] border border-white/10 space-y-2">
          <span className="text-xs font-mono uppercase text-white/50">API Requests</span>
          <div className="text-2xl font-extrabold text-indigo-400">
            {loading ? '...' : (metrics?.apiRequests ?? 0).toLocaleString()}
          </div>
          <p className="text-[11px] text-white/40 font-mono">Recorded endpoint hits</p>
        </div>
      </div>

      {/* Data Visualization State */}
      <div className="p-8 rounded-2xl bg-[#12121A] border border-white/10 text-center space-y-3">
        <BarChart3 className="w-10 h-10 text-white/20 mx-auto" />
        <h3 className="text-sm font-bold text-white">Time Series Analytics</h3>
        {hasData ? (
          <p className="text-xs text-white/60 max-w-md mx-auto">
            Aggregating historical trends based on active telemetry. Full hourly distribution will accumulate as more download jobs complete.
          </p>
        ) : (
          <p className="text-xs text-white/40 max-w-md mx-auto">
            No historical metric records accumulated yet for this period. Trends will automatically populate as extractions occur.
          </p>
        )}
      </div>
    </div>
  );
}
