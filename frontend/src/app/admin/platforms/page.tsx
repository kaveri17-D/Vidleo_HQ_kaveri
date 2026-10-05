'use client';

import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle2, ShieldCheck, RefreshCw, Radio, ExternalLink } from 'lucide-react';

interface PlatformRecord {
  name: string;
  domain: string;
  status: string;
  type: string;
  maxQuality: string;
  poTokenProtected: boolean;
}

export default function AdminPlatformsPage() {
  const [platforms, setPlatforms] = useState<PlatformRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlatforms = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=platforms', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setPlatforms(data.platforms || []);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlatforms();
  }, []);

  return (
    <div className="space-y-6 text-white font-sans max-w-5xl">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            Supported Media Platforms
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Verified extractors configured directly in Vidleo's backend extraction engine (<code className="text-[#5B4BFF] font-mono">extractor_service.py</code>).
          </p>
        </div>

        <button
          type="button"
          onClick={fetchPlatforms}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Grid of Implemented Platforms */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-12 text-center text-white/40">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#5B4BFF]" />
            <p className="text-xs">Loading extractor catalog...</p>
          </div>
        ) : (
          platforms.map((p) => (
            <div
              key={p.name}
              className="p-5 rounded-2xl bg-[#12121A] border border-white/10 hover:border-white/20 transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#5B4BFF]/20 border border-[#5B4BFF]/30 text-[#5B4BFF] flex items-center justify-center font-bold text-sm">
                    {p.name[0]}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{p.name}</h3>
                    <p className="text-[11px] font-mono text-white/40">{p.domain}</p>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{p.status}</span>
                </span>
              </div>

              <div className="pt-2 border-t border-white/[0.06] space-y-1.5 text-xs">
                <div className="flex justify-between text-white/60">
                  <span className="font-mono text-[10px] uppercase text-white/40">Media Type</span>
                  <span className="font-medium text-white">{p.type}</span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span className="font-mono text-[10px] uppercase text-white/40">Max Resolution</span>
                  <span className="font-medium text-white">{p.maxQuality}</span>
                </div>
                {p.poTokenProtected && (
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-400">
                      <ShieldCheck className="w-3 h-3" />
                      <span>PO Token Sidecar Enabled</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
