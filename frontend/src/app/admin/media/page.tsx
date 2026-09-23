'use client';

import React, { useState } from 'react';
import { Film, Search, Filter, PlayCircle, Download, CheckCircle2, Clock, FileVideo } from 'lucide-react';

const DEMO_MEDIA = [
  {
    id: 'med-1',
    title: '4K Cinematic Mountain Drone Footage',
    platform: 'YouTube',
    format: 'MP4',
    quality: '2160p (4K)',
    size: '420 MB',
    status: 'Completed',
    created: '10 mins ago',
  },
  {
    id: 'med-2',
    title: 'Minimalist Studio Desk Tour',
    platform: 'Instagram Reels',
    format: 'MP4',
    quality: '1080p',
    size: '85 MB',
    status: 'Completed',
    created: '25 mins ago',
  },
  {
    id: 'med-3',
    title: 'Lo-Fi Chill Beats 24/7 Audio Stream',
    platform: 'SoundCloud',
    format: 'MP3',
    quality: '320 kbps',
    size: '45 MB',
    status: 'Completed',
    created: '1 hour ago',
  },
  {
    id: 'med-4',
    title: 'High Speed Motion Graphics Reel',
    platform: 'Vimeo',
    format: 'MP4',
    quality: '1080p',
    size: '190 MB',
    status: 'Processing',
    created: '2 hours ago',
  },
];

export default function AdminMediaPage() {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('All');

  const filteredMedia = DEMO_MEDIA.filter((m) => {
    const matchesSearch = m.title.toLowerCase().includes(search.toLowerCase()) || m.platform.toLowerCase().includes(search.toLowerCase());
    const matchesPlatform = platformFilter === 'All' || m.platform.toLowerCase().includes(platformFilter.toLowerCase());
    return matchesSearch && matchesPlatform;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      
      {/* Title Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
          Media Extraction Logs
        </h1>
        <p className="text-xs text-white/60 pt-1">
          Inspect processed video files, format extractions, quality presets, and conversion jobs.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#12121A] border border-white/10">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media title or platform..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/40 text-xs focus:outline-none focus:border-[#5B4BFF]"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {['All', 'YouTube', 'Instagram', 'Vimeo', 'SoundCloud'].map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                platformFilter === p
                  ? 'bg-[#5B4BFF] text-white shadow-md'
                  : 'bg-white/[0.05] text-white/60 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Media Table */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="py-3.5 px-5">Media Title</th>
                <th className="py-3.5 px-5">Platform</th>
                <th className="py-3.5 px-5">Format & Quality</th>
                <th className="py-3.5 px-5">File Size</th>
                <th className="py-3.5 px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredMedia.map((m) => (
                <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center shrink-0">
                        <FileVideo className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-white text-xs truncate max-w-xs">{m.title}</span>
                    </div>
                  </td>
                  <td className="py-4 px-5 font-mono text-[11px] text-white/70">{m.platform}</td>
                  <td className="py-4 px-5 font-mono text-[11px] text-white/70">{m.format} · {m.quality}</td>
                  <td className="py-4 px-5 font-mono text-[11px] text-white/70">{m.size}</td>
                  <td className="py-4 px-5">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                        m.status === 'Completed' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'Completed' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      {m.status}
                    </span>
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
