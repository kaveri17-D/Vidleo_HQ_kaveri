'use client';

import React, { useState } from 'react';
import { Download, CheckCircle2, Clock, AlertTriangle, RefreshCw, Search } from 'lucide-react';

const DEMO_DOWNLOAD_JOBS = [
  {
    id: 'job-101',
    userEmail: 'user@example.com',
    sourceUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
    platform: 'YouTube',
    format: 'MP4',
    quality: '1080p',
    status: 'Completed',
    time: '2 mins ago',
    failureReason: null,
  },
  {
    id: 'job-102',
    userEmail: 'creator@agency.com',
    sourceUrl: 'https://instagram.com/reel/C123456789/',
    platform: 'Instagram',
    format: 'MP4',
    quality: '1080p',
    status: 'Processing',
    time: '5 mins ago',
    failureReason: null,
  },
  {
    id: 'job-103',
    userEmail: 'editor@studio.io',
    sourceUrl: 'https://tiktok.com/@video/12345678',
    platform: 'TikTok',
    format: 'MP3',
    quality: '320 kbps',
    status: 'Failed',
    time: '12 mins ago',
    failureReason: 'Rate limit hit on upstream stream provider (HTTP 429)',
  },
];

export default function AdminDownloadsPage() {
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');

  const filteredJobs = DEMO_DOWNLOAD_JOBS.filter((job) => {
    const matchesStatus = statusFilter === 'All' || job.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesSearch = job.userEmail.toLowerCase().includes(search.toLowerCase()) || job.platform.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      
      {/* Title Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
          Download Queue & Job Monitor
        </h1>
        <p className="text-xs text-white/60 pt-1">
          Monitor active, completed, and failed video extraction jobs across server workers.
        </p>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#12121A] border border-white/10">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by user or platform..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/40 text-xs focus:outline-none focus:border-[#5B4BFF]"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {['All', 'Completed', 'Processing', 'Failed'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
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

      {/* Jobs Table */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="py-3.5 px-5">Job ID & User</th>
                <th className="py-3.5 px-5">Platform & Quality</th>
                <th className="py-3.5 px-5">Status</th>
                <th className="py-3.5 px-5">Time</th>
                <th className="py-3.5 px-5">Details / Failure Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredJobs.map((job) => (
                <tr key={job.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-5">
                    <div>
                      <span className="font-mono text-white font-semibold block">{job.id}</span>
                      <span className="text-[11px] text-white/50">{job.userEmail}</span>
                    </div>
                  </td>
                  <td className="py-4 px-5 font-mono text-[11px] text-white/80">
                    {job.platform} · {job.format} ({job.quality})
                  </td>
                  <td className="py-4 px-5">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase ${
                        job.status === 'Completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : job.status === 'Processing'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="py-4 px-5 font-mono text-[11px] text-white/50">{job.time}</td>
                  <td className="py-4 px-5 text-xs text-white/60">
                    {job.failureReason ? (
                      <span className="text-red-400 font-mono text-[11px]">{job.failureReason}</span>
                    ) : (
                      <span className="text-emerald-400/80 font-mono text-[11px]">Clean Extraction</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
