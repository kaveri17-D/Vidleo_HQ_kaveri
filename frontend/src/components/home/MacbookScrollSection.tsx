'use client';

import React from 'react';
import { MacbookScroll } from '@/components/macbook/MacbookScroll';
import { Sparkles, ArrowDown, Film, Layers, CheckCircle2 } from 'lucide-react';

export function MacbookScrollSection() {
  return (
    <section className="relative w-full bg-[#0B0B0C] border-t border-white/[0.06] pt-24 pb-8 overflow-hidden">
      {/* Background radial ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-accent/[0.02] rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Editorial Intro Header */}
        <div className="text-center max-w-3xl mx-auto mb-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#141417] border border-white/[0.09] text-[11px] font-sans font-medium tracking-[0.12em] text-accent shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="uppercase text-[10.5px] font-semibold">
              01 / THE EXPERIENCE
            </span>
          </div>

          <h2 className="font-display font-[780] text-4xl sm:text-6xl md:text-7xl text-foreground tracking-[-0.04em] leading-[0.95]">
            From link<br />
            <span className="italic font-display font-[780] text-muted-light">to video.</span>
          </h2>

          <p className="text-sm sm:text-base md:text-lg text-muted max-w-xl mx-auto font-sans font-normal leading-relaxed pt-1">
            Paste a link. Choose your quality. Download the video without the unnecessary friction.
          </p>

          {/* Quick Flow Pills */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-sans">
            <span className="px-3 py-1 rounded-full bg-surface-2 border border-white/[0.06] text-muted-light flex items-center gap-1.5">
              <span className="text-accent font-bold">01</span> Paste URL
            </span>
            <span className="text-muted-dark">→</span>
            <span className="px-3 py-1 rounded-full bg-surface-2 border border-white/[0.06] text-muted-light flex items-center gap-1.5">
              <span className="text-accent font-bold">02</span> Inspect Manifest
            </span>
            <span className="text-muted-dark">→</span>
            <span className="px-3 py-1 rounded-full bg-surface-2 border border-white/[0.06] text-muted-light flex items-center gap-1.5">
              <span className="text-accent font-bold">03</span> Direct 4K Download
            </span>
          </div>
        </div>

        {/* 3D Scroll-Driven Macbook Component */}
        <div className="relative w-full">
          <MacbookScroll
            badge={
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#121216] border border-white/10 text-xs font-sans text-muted-light shadow-xl">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-light">
                  VIDLEO DESKTOP SUITE · BUILT FOR THE WEB
                </span>
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
}
