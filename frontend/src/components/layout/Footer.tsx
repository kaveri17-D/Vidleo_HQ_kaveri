'use client';

import React from 'react';
import Link from 'next/link';
import { 
  ArrowRight, 
  MapPin, 
  Globe, 
  Activity, 
  Instagram, 
  Youtube, 
  Linkedin,
  ArrowUpRight,
  Play
} from 'lucide-react';
import { VidleoLogo } from '@/components/brand/VidleoLogo';
import { EXTERNAL_LINKS } from '@/config/links';

// Custom Minimalist X (formerly Twitter) Icon
function XIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="w-full bg-[#121212] text-[#F5F3EE] border-t border-white/[0.08] relative overflow-hidden pt-16 sm:pt-24 pb-10 sm:pb-12 selection:bg-white selection:text-black font-sans">
      <div className="max-w-[1340px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* ===================================================================
            1. TOP FOOTER TWO-COLUMN COMPOSITION (Reference Match)
            Left: Brand Identity, Editorial Statement, Location info, Follow Us
            Right: Large CTA Card + 4 Navigation Columns
            =================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 pb-16 lg:pb-20">
          
          {/* LEFT COLUMN: BRAND & EDITORIAL STATEMENT */}
          <div className="lg:col-span-5 space-y-7">
            {/* Logo matching the reference design */}
            <div>
              <Link href="/" aria-label="Vidleo homepage">
                <VidleoLogo size="lg" isLight={false} showSublabel={true} />
              </Link>
            </div>

            {/* Main Editorial Headline */}
            <h2 className="text-3xl sm:text-4xl lg:text-[40px] font-sans font-extrabold text-white tracking-[-0.035em] leading-[1.12]">
              Media extraction, <br />
              <span className="font-serif italic font-normal text-white/95">simplified.</span>
            </h2>

            {/* Concise Editorial Description */}
            <p className="text-xs sm:text-sm text-white/60 font-sans leading-relaxed max-w-sm">
              Download and prepare high-quality media from the platforms you use, without unnecessary complexity.
            </p>

            {/* Location & Infrastructure Meta */}
            <div className="space-y-2.5 pt-1 text-xs font-mono text-white/60">
              <div className="flex items-center gap-2.5">
                <MapPin className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <span>India</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Globe className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <span>Global Media Infrastructure</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Activity className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <span>Available Worldwide</span>
              </div>
            </div>

            {/* Follow Us Minimal Icon Buttons */}
            <div className="pt-3 space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 block">
                FOLLOW US
              </span>
              <div className="flex items-center gap-2.5">
                <a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  className="w-9 h-9 rounded-lg bg-[#202020] hover:bg-[#2A2A2A] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5"
                >
                  <Instagram className="w-4 h-4" />
                </a>
                <a
                  href="https://youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="YouTube"
                  className="w-9 h-9 rounded-lg bg-[#202020] hover:bg-[#2A2A2A] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5"
                >
                  <Youtube className="w-4 h-4" />
                </a>
                <a
                  href="https://x.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="X (Twitter)"
                  className="w-9 h-9 rounded-lg bg-[#202020] hover:bg-[#2A2A2A] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </a>
                <a
                  href="https://linkedin.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="LinkedIn"
                  className="w-9 h-9 rounded-lg bg-[#202020] hover:bg-[#2A2A2A] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5"
                >
                  <Linkedin className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: CTA SURFACE & 4-COLUMN NAVIGATION */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-12">
            
            {/* TOP CTA CARD (Reference Match) */}
            <div className="rounded-2xl sm:rounded-3xl bg-[#1A1A1A] border border-white/[0.08] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative overflow-hidden group">
              {/* Left CTA Action */}
              <div className="space-y-4">
                <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.2em] text-white/50 block">
                  READY TO GET STARTED?
                </span>
                <Link
                  href="/download"
                  className="inline-flex items-center justify-center gap-3 bg-[#F5F3EE] hover:bg-white text-black font-sans font-bold text-xs sm:text-sm px-7 py-3.5 rounded-full transition-all duration-300 hover:-translate-y-0.5 shadow-md hover:shadow-xl shadow-black/40 group/btn"
                >
                  <span>Start Downloading</span>
                  <ArrowRight className="w-4 h-4 stroke-[2.5] transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                </Link>
              </div>

              {/* Right CTA Micro Statement */}
              <div className="sm:text-right text-xs text-white/45 font-sans leading-relaxed border-t sm:border-t-0 pt-4 sm:pt-0 border-white/[0.06]">
                <p>One URL.</p>
                <p>Any platform.</p>
                <p className="text-white/70">Your media.</p>
              </div>
            </div>

            {/* 4 NAVIGATION COLUMNS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-6 pt-2">
              
              {/* 1. PRODUCT */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold tracking-[0.16em] uppercase text-white/50">
                  PRODUCT
                </h3>
                <ul className="space-y-2.5 text-xs font-sans">
                  <li>
                    <Link href="/download" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      New Download
                    </Link>
                  </li>
                  <li>
                    <Link href="/history" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      History
                    </Link>
                  </li>
                  <li>
                    <Link href="/supported-sites" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Supported Sites
                    </Link>
                  </li>
                  <li>
                    <Link href="/#how-it-works" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      How It Works
                    </Link>
                  </li>
                </ul>
              </div>

              {/* 2. RESOURCES */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold tracking-[0.16em] uppercase text-white/50">
                  RESOURCES
                </h3>
                <ul className="space-y-2.5 text-xs font-sans">
                  <li>
                    <Link href="/#faq" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      FAQ
                    </Link>
                  </li>
                  <li>
                    <Link href="/#faq" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Help Center
                    </Link>
                  </li>
                  <li>
                    <Link href="/supported-sites" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Supported Platforms
                    </Link>
                  </li>
                  <li>
                    <Link href="/contact" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Contact Support
                    </Link>
                  </li>
                </ul>
              </div>

              {/* 3. COMPANY */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold tracking-[0.16em] uppercase text-white/50">
                  COMPANY
                </h3>
                <ul className="space-y-2.5 text-xs font-sans">
                  <li>
                    <Link href="/about" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      About
                    </Link>
                  </li>
                  <li>
                    <Link href="/contact" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Contact
                    </Link>
                  </li>
                  <li>
                    <Link href="/pricing" className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1">
                      Pricing
                    </Link>
                  </li>
                  <li>
                    <a 
                      href={EXTERNAL_LINKS.CLIPPER_X} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-white/70 hover:text-white transition-all duration-200 inline-flex items-center gap-1 hover:translate-x-1"
                    >
                      <span>ClipperX AI</span>
                      <ArrowUpRight className="w-3 h-3 text-white/40" />
                    </a>
                  </li>
                </ul>
              </div>

              {/* 4. SOCIAL */}
              <div className="space-y-4">
                <h3 className="text-[11px] font-mono font-bold tracking-[0.16em] uppercase text-white/50">
                  SOCIAL
                </h3>
                <ul className="space-y-2.5 text-xs font-sans">
                  <li>
                    <a 
                      href="https://instagram.com" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1"
                    >
                      Instagram
                    </a>
                  </li>
                  <li>
                    <a 
                      href="https://youtube.com" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1"
                    >
                      YouTube
                    </a>
                  </li>
                  <li>
                    <a 
                      href="https://x.com" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1"
                    >
                      X (Twitter)
                    </a>
                  </li>
                  <li>
                    <a 
                      href="https://linkedin.com" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-white/70 hover:text-white transition-all duration-200 inline-block hover:translate-x-1"
                    >
                      LinkedIn
                    </a>
                  </li>
                </ul>
              </div>

            </div>

          </div>

        </div>

        {/* ===================================================================
            2. CREATIVE BRAND ELEMENT: GEOMETRIC 3D MONOLITHS (Reference Match)
            Modular 3D-styled physical monolith tiles for V - I - D - L - E - O
            =================================================================== */}
        <div className="pt-8 pb-14 flex flex-col items-center justify-center relative select-none">
          
          {/* Subtle Ground Horizon Shadow */}
          <div className="w-full max-w-4xl h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent mb-6 sm:mb-8" />

          {/* 6 Geometric Monoliths */}
          <div className="flex items-end justify-center gap-3 sm:gap-6 md:gap-8 w-full overflow-x-auto py-4 px-2 no-scrollbar">
            
            {/* V — Cube */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-xl bg-gradient-to-b from-[#2A2A2A] to-[#161616] border-t border-l border-white/[0.18] border-r border-b border-black/80 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateX(8deg) rotateY(-4deg)',
                }}
              >
                <span className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md">
                  V
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

            {/* I — Rotated Diamond Monolith */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-xl bg-gradient-to-br from-[#2D2D2D] via-[#222222] to-[#141414] border-t border-l border-white/[0.18] border-r border-b border-black/80 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateZ(22deg) rotateX(10deg)',
                }}
              >
                <span 
                  className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md"
                  style={{ transform: 'rotateZ(-22deg)' }}
                >
                  I
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

            {/* D — Cube */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-xl bg-gradient-to-b from-[#2A2A2A] to-[#161616] border-t border-l border-white/[0.18] border-r border-b border-black/80 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateX(8deg) rotateY(2deg)',
                }}
              >
                <span className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md">
                  D
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

            {/* L — Angled Wedge Prism */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-xl bg-gradient-to-tr from-[#1E1E1E] via-[#262626] to-[#141414] border-t border-r border-white/[0.18] border-l border-b border-black/80 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateY(18deg) rotateX(12deg) skewX(-6deg)',
                }}
              >
                <span className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md">
                  L
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

            {/* E — Faceted Hex Monolith */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-xl bg-gradient-to-b from-[#2A2A2A] via-[#202020] to-[#141414] border-t border-l border-white/[0.18] border-r border-b border-black/80 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateY(-12deg) rotateX(14deg)',
                }}
              >
                <span className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md">
                  E
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

            {/* O — Cylinder / Disc Monolith */}
            <div className="group relative flex flex-col items-center transition-transform duration-300 hover:-translate-y-2 cursor-default">
              <div 
                className="w-14 h-16 sm:w-20 sm:h-24 md:w-24 md:h-28 rounded-full bg-gradient-to-b from-[#282828] via-[#1C1C1C] to-[#121212] border-t border-l border-white/[0.22] border-r border-b border-black/90 flex items-center justify-center shadow-[0_18px_35px_-8px_rgba(0,0,0,0.9)]"
                style={{
                  transform: 'perspective(600px) rotateX(15deg)',
                }}
              >
                <span className="font-display font-[850] text-xl sm:text-3xl md:text-4xl text-white/95 tracking-wider drop-shadow-md">
                  O
                </span>
              </div>
              <div className="w-12 sm:w-16 h-2 sm:h-3 rounded-full bg-black/70 blur-[4px] mt-2 group-hover:scale-90 transition-transform" />
            </div>

          </div>
        </div>

        {/* ===================================================================
            3. THIN HORIZONTAL DIVIDER (Reference Match: rgba(255,255,255,0.10))
            =================================================================== */}
        <div className="w-full h-px bg-white/[0.10]" />

        {/* ===================================================================
            4. BOTTOM LEGAL BAR
            Left: Copyright
            Right: Privacy Policy & Terms & Conditions
            =================================================================== */}
        <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-white/50">
          <div>
            © 2026 Vidleo. A Synapvo Product. All rights reserved.
          </div>

          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms & Conditions
            </Link>
            <Link href="/admin/login" className="hover:text-white/80 text-white/30 transition-colors text-[11px]">
              Admin
            </Link>
          </div>
        </div>

      </div>
    </footer>
  );
}
