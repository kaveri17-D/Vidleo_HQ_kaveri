'use client';

import React from 'react';
import { 
  Download, 
  Link as LinkIcon, 
  ArrowRight, 
  Check, 
  Sparkles, 
  Clock, 
  Eye, 
  Film, 
  Video, 
  Music, 
  HardDrive,
  ShieldCheck
} from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';

/**
 * Realistic Desktop Vidleo UI rendered inside the MacBook screen display.
 */
export function MacbookScreenContent() {
  return (
    <div className="w-full h-full bg-[#0E0E11] text-[#F5F5F2] flex flex-col font-sans select-none overflow-hidden relative border border-white/[0.06]">
      {/* Top Window Bar */}
      <div className="h-8 bg-[#16161A] border-b border-white/[0.08] px-3.5 flex items-center justify-between shrink-0">
        {/* Window controls */}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/80" />
        </div>

        {/* Browser URL / App Title Pill */}
        <div className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-[#0E0E11] border border-white/[0.06] text-[10px] font-mono text-muted-light">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="tracking-wide">app.vidleo.synapvo.tech/download</span>
        </div>

        {/* Right Status */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted">
          <span className="text-accent font-semibold">10 Gbps CDN</span>
        </div>
      </div>

      {/* App Navbar */}
      <div className="h-11 bg-[#121215] border-b border-white/[0.06] px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <VidleoLogo size="xs" isLight={false} />
          <span className="text-[9px] font-mono text-muted-dark border-l border-white/10 pl-2 ml-1 uppercase">
            PRO SUITE
          </span>
        </div>

        <div className="flex items-center gap-1 bg-[#18181D] px-2 py-1 rounded-lg border border-white/[0.05] text-[11px] font-medium text-muted-light">
          <span className="px-2 py-0.5 rounded bg-white/[0.08] text-white">Downloader</span>
          <span className="px-2 py-0.5 hover:text-white transition-colors">History (14)</span>
          <span className="px-2 py-0.5 hover:text-white transition-colors">Settings</span>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-gradient-to-b from-[#0E0E11] to-[#121216]">
        {/* Mini Header */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-accent font-semibold">
              ACQUISITION MANIFEST
            </span>
            <h2 className="font-display font-bold text-sm text-foreground tracking-tight">
              Universal Stream Analyzer
            </h2>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-3 border border-white/10 text-muted-light">
            YouTube 4K Detected
          </span>
        </div>

        {/* URL Input Bar in Screen Mockup */}
        <div className="flex items-center gap-2 bg-[#16161B] border border-white/[0.12] rounded-xl p-1.5 shadow-md">
          <div className="flex items-center gap-2 pl-2.5 text-muted shrink-0">
            <LinkIcon className="w-3.5 h-3.5 text-accent" />
            <span className="text-[10px] font-mono uppercase bg-white/10 px-1.5 py-0.2 rounded text-white">
              YouTube
            </span>
          </div>

          <input
            readOnly
            value="https://youtube.com/watch?v=dQw4w9WgXcQ (DaVinci Resolve 4K Master)"
            className="w-full bg-transparent text-xs text-foreground font-sans truncate focus:outline-none"
          />

          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1.5 bg-[#F5F5F2] text-[#0B0B0C] px-3 py-1.5 rounded-lg text-[11px] font-bold font-display uppercase tracking-wider shadow-sm"
          >
            <span>Analyzed</span>
            <Check className="w-3 h-3 text-[#0B0B0C]" />
          </button>
        </div>

        {/* Detected Video Card Display */}
        <div className="bg-[#141418] border border-white/[0.1] rounded-xl p-3.5 shadow-xl space-y-3">
          {/* Top Row: Thumbnail + Info */}
          <div className="flex gap-3 items-start">
            <div className="relative w-28 h-18 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=600&auto=format&fit=crop"
                alt="Cinema Reel Mockup"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1 right-1 px-1 py-0.2 bg-black/80 rounded text-[8.5px] font-mono text-white flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5 text-accent" />
                <span>12:42</span>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-muted">
                <span className="text-accent font-semibold">CineAesthetic Labs</span>
                <span>·</span>
                <span>1.4M views</span>
              </div>
              <h3 className="text-xs font-bold text-white line-clamp-1 font-sans">
                The Future of Creative Media — 8K RAW Anamorphic Color Pipeline
              </h3>
              <p className="text-[10px] text-muted line-clamp-1 font-sans">
                Full dynamic range stream with 24-bit 96kHz spatial audio channels.
              </p>
            </div>
          </div>

          {/* Quality Options & Format Row */}
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.04]">
            {/* 4K 60fps Option (Selected) */}
            <div className="p-2 rounded-lg bg-[#1E1E26] border border-accent/60 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-white">4K 2160p</span>
                  <span className="text-[7.5px] font-mono bg-accent text-background px-1 rounded font-bold uppercase">
                    MAX
                  </span>
                </div>
                <p className="text-[9px] font-mono text-muted">60fps · MP4</p>
              </div>
              <span className="text-[10px] font-mono font-bold text-accent">312 MB</span>
            </div>

            {/* 1080p FHD */}
            <div className="p-2 rounded-lg bg-[#18181D] border border-white/[0.06] flex items-center justify-between opacity-80">
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-white">1080p FHD</span>
                <p className="text-[9px] font-mono text-muted">60fps · MP4</p>
              </div>
              <span className="text-[10px] font-mono text-muted-light">94 MB</span>
            </div>

            {/* 320kbps MP3 */}
            <div className="p-2 rounded-lg bg-[#18181D] border border-white/[0.06] flex items-center justify-between opacity-80">
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-white">320k Audio</span>
                <p className="text-[9px] font-mono text-muted">Studio MP3</p>
              </div>
              <span className="text-[10px] font-mono text-muted-light">16 MB</span>
            </div>
          </div>

          {/* Download CTA in screen */}
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-[#F5F5F2] text-[#0B0B0C] py-2 rounded-lg font-display font-bold text-xs uppercase tracking-wider shadow-md"
          >
            <Download className="w-3.5 h-3.5 text-[#0B0B0C]" />
            <span>Download 4K Stream (312.4 MB) →</span>
          </button>
        </div>
      </div>
    </div>
  );
}
