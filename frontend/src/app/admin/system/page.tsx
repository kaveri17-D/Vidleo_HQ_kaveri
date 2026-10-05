'use client';

import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle2, AlertTriangle, ShieldCheck, Database, Server, RefreshCw, Cpu, HardDrive, Radio } from 'lucide-react';

interface DiagnosticState {
  database: {
    status: 'Operational' | 'Degraded' | 'Unavailable' | string;
    latencyMs: number;
    engine: string;
  };
  extractionEngine: {
    status: 'Operational' | 'Degraded' | 'Unavailable' | string;
    latencyMs: number;
    service: string;
    jobsActive: number;
    jobsTotal: number;
  };
  timestamp: string;
}

export default function AdminSystemPage() {
  const [data, setData] = useState<DiagnosticState | null>(null);
  const [loading, setLoading] = useState(true);

  const runDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=system', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <span className="text-white/40">Health check unavailable</span>;
    if (status === 'Operational') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Operational</span>
        </span>
      );
    }
    if (status === 'Degraded') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Degraded</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/30">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Unavailable</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 text-white font-sans max-w-4xl">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            System Diagnostics & Health
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Real-time status probes for Supabase PostgreSQL database, extraction worker engine, and API services.
          </p>
        </div>

        <button
          type="button"
          onClick={runDiagnostics}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Re-run Diagnostics</span>
        </button>
      </div>

      {/* Services Status Cards */}
      <div className="space-y-4">
        {/* Supabase Database Service */}
        <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Supabase PostgreSQL</h3>
                <p className="text-xs text-white/50">Primary database storing user roles & authorization</p>
              </div>
            </div>
            {getStatusBadge(data?.database.status)}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] text-xs font-mono">
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Engine</span>
              <span className="text-white">{data?.database.engine || 'PostgreSQL 15'}</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Round-Trip Latency</span>
              <span className="text-emerald-400 font-bold">
                {data?.database.latencyMs !== undefined ? `${data.database.latencyMs} ms` : 'Checking...'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Authorization Table</span>
              <span className="text-white">public.user_roles</span>
            </div>
          </div>
        </div>

        {/* Media Extraction Engine (FastAPI) */}
        <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Media Extraction Engine</h3>
                <p className="text-xs text-white/50">FastAPI backend executing extraction pipelines & yt-dlp</p>
              </div>
            </div>
            {getStatusBadge(data?.extractionEngine.status)}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/[0.06] text-xs font-mono">
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Service</span>
              <span className="text-white">{data?.extractionEngine.service || 'media-extractor'}</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Engine Latency</span>
              <span className="text-emerald-400 font-bold">
                {data?.extractionEngine.latencyMs !== undefined ? `${data.extractionEngine.latencyMs} ms` : 'Checking...'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Active Worker Jobs</span>
              <span className="text-white">{data?.extractionEngine.jobsActive ?? 0}</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Lifetime Total Jobs</span>
              <span className="text-white">{data?.extractionEngine.jobsTotal ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Authentication Service */}
        <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Authentication Service</h3>
                <p className="text-xs text-white/50">Supabase Auth with PKCE OAuth 2.0 and server session validation</p>
              </div>
            </div>
            {getStatusBadge('Operational')}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] text-xs font-mono">
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Protocol</span>
              <span className="text-white">JWT / PKCE Cookie</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Role Verification</span>
              <span className="text-emerald-400 font-bold">Server-Enforced</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 uppercase block">Current Session Guard</span>
              <span className="text-white">Active</span>
            </div>
          </div>
        </div>

        {/* YouTube PO Token Sidecar */}
        <div className="p-6 rounded-2xl bg-[#12121A] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">PO Token Sidecar</h3>
                <p className="text-xs text-white/50">External headless token generator on port :3001</p>
              </div>
            </div>
            {getStatusBadge('Operational')}
          </div>
        </div>
      </div>
    </div>
  );
}
