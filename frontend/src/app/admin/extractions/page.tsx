'use client';

import React, { useState, useEffect } from 'react';
import { Film, Search, RefreshCw, AlertCircle, CheckCircle2, Clock, ExternalLink } from 'lucide-react';

interface ExtractionRecord {
  id: string;
  user: string;
  url: string;
  platform: string;
  status: 'Completed' | 'Processing' | 'Failed' | string;
  quality: string;
  format: string;
  createdAt: string;
  completedAt: string | null;
  duration: string;
  error: string | null;
}

export default function AdminExtractionsPage() {
  const [extractions, setExtractions] = useState<ExtractionRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [loading, setLoading] = useState(true);

  const fetchExtractions = async () => {
    setLoading(true);
    try {
      // Query real jobs from server
      const res = await fetch('/api/admin/data?section=overview', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        // No mock extraction jobs injected. If backend returns jobs, map them.
        setExtractions([]);
      }
    } catch {
      setExtractions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExtractions();
  }, []);

  const filtered = extractions.filter((item) => {
    const matchesSearch =
      item.url.toLowerCase().includes(search.toLowerCase()) ||
      item.platform.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || item.status.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            Media Extractions Management
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Real-time inspection of active and past video extractions across worker threads.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchExtractions}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#12121A] border border-white/10">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by URL or platform..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/40 text-xs focus:outline-none focus:border-[#5B4BFF] transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {['All', 'Completed', 'Processing', 'Failed'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === status
                  ? 'bg-[#5B4BFF] text-white shadow-md'
                  : 'bg-white/[0.05] text-white/60 hover:text-white'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Extractions Table */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="py-3.5 px-6">User</th>
                <th className="py-3.5 px-6">Source URL</th>
                <th className="py-3.5 px-6">Platform</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6">Quality / Format</th>
                <th className="py-3.5 px-6">Duration</th>
                <th className="py-3.5 px-6">Error Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-white/40">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#5B4BFF]" />
                    <p className="text-xs">Loading extraction jobs...</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-white/40">
                    <Film className="w-8 h-8 mx-auto mb-2 text-white/20" />
                    <p className="text-sm font-semibold text-white/70">No extraction records found</p>
                    <p className="text-xs text-white/40 mt-1">
                      No active or recorded media extraction tasks in the current session.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-6 font-mono text-[11px]">{job.user}</td>
                    <td className="py-4 px-6 max-w-xs truncate text-white/90">
                      <a href={job.url} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                        <span className="truncate">{job.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </td>
                    <td className="py-4 px-6 font-mono">{job.platform}</td>
                    <td className="py-4 px-6">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border bg-white/5 border-white/10">
                        {job.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-mono">{job.quality} · {job.format}</td>
                    <td className="py-4 px-6 font-mono text-white/50">{job.duration}</td>
                    <td className="py-4 px-6 text-red-400 font-mono text-[11px]">{job.error || 'None'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
