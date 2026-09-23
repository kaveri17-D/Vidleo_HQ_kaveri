'use client';

import React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import {
  ArrowRight,
  Sparkles,
  Zap,
  Globe,
  Layers,
  Compass,
  FolderCheck,
  Video,
  ShieldCheck,
  Cpu,
  Check,
  ExternalLink,
  ChevronRight,
  Play,
  Share2,
  HardDrive,
  Sliders,
  FileVideo,
  Music,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXTERNAL_LINKS } from '@/config/links';
import { VidleoSymbol } from '@/components/brand/VidleoLogo';

/* =========================================================================
   PLATFORM DATA (9 PLATFORMS - NO TIKTOK)
   ========================================================================= */

interface PlatformCard {
  name: string;
  category: string;
  description: string;
  accent: string; // Tailwind color class for hover/border
  accentBg: string;
  badge: string;
  icon: React.ReactNode;
}

const PLATFORMS: PlatformCard[] = [
  {
    name: 'YouTube',
    category: 'Video & Shorts',
    description: '4K Ultra HD video, playlists, shorts, and multi-channel media parsing.',
    accent: '#FF0000',
    accentBg: 'bg-red-500/10 text-red-600 border-red-200/50',
    badge: '4K 60FPS',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF0000]">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    name: 'Instagram',
    category: 'Reels & Posts',
    description: 'Crisp MP4 Reels, video posts, and carousel media extraction.',
    accent: '#E4405F',
    accentBg: 'bg-pink-500/10 text-pink-600 border-pink-200/50',
    badge: 'HD REELS',
    icon: (
      <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center shadow-xs">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </div>
    ),
  },
  {
    name: 'Vimeo',
    category: 'Cinematic & Portfolio',
    description: 'Lossless audio and original quality video for filmmakers.',
    accent: '#1AB7EA',
    accentBg: 'bg-sky-500/10 text-sky-600 border-sky-200/50',
    badge: 'LOSSLESS',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#1AB7EA]">
        <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128 1.581-1.378 2.764-2.106 3.553-2.18 1.876-.179 3.033 1.096 3.473 3.824.526 3.26 1.006 5.86 1.442 7.799.435 1.939 1.044 2.909 1.826 2.909.608 0 1.524-.963 2.748-2.887 1.224-1.924 1.868-3.414 1.932-4.471.133-1.638-.475-2.457-1.826-2.457-.65 0-1.344.152-2.082.456 1.344-4.398 3.916-6.521 7.718-6.37 2.823.109 4.148 1.934 3.972 5.48z" />
      </svg>
    ),
  },
  {
    name: 'X (Twitter)',
    category: 'Clips & Threads',
    description: 'Direct MP4 downloads from posts, broadcast clips, and GIFs.',
    accent: '#374151',
    accentBg: 'bg-neutral-800/10 text-neutral-800 border-neutral-300/50',
    badge: 'DIRECT MP4',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-black">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: 'Reddit',
    category: 'Community & Clips',
    description: 'Full resolution video with automatically synced audio tracks.',
    accent: '#FF4500',
    accentBg: 'bg-orange-500/10 text-orange-600 border-orange-200/50',
    badge: 'AUDIO MUXED',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF4500]">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701z" />
      </svg>
    ),
  },
  {
    name: 'Pinterest',
    category: 'Idea Pins & Videos',
    description: 'High quality video pin downloads for design & moodboard curation.',
    accent: '#E60023',
    accentBg: 'bg-rose-500/10 text-rose-600 border-rose-200/50',
    badge: 'IDEA PINS',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#E60023]">
        <path d="M12 0a12 12 0 0 0-4.37 23.17c-.07-.63-.13-1.6.03-2.29.14-.62.92-3.88.92-3.88s-.24-.47-.24-1.17c0-1.1.64-1.92 1.44-1.92.68 0 1 .51 1 1.12 0 .68-.43 1.7-.66 2.64-.19.79.4 1.44 1.18 1.44 1.41 0 2.5-1.49 2.5-3.64 0-1.9-1.37-3.23-3.32-3.23-2.26 0-3.59 1.7-3.59 3.45 0 .68.26 1.42.59 1.81.06.08.07.15.05.24-.07.28-.22.9-.25 1.03-.04.17-.14.21-.32.13-1.19-.55-1.93-2.28-1.93-3.67 0-2.98 2.17-5.72 6.26-5.72 3.28 0 5.84 2.34 5.84 5.47 0 3.26-2.06 5.89-4.91 5.89-.96 0-1.86-.5-2.17-1.09l-.59 2.25c-.21.83-.79 1.86-1.18 2.49A12 12 0 1 0 12 0z" />
      </svg>
    ),
  },
  {
    name: 'SoundCloud',
    category: 'Audio & Playlists',
    description: '320 kbps high-bitrate MP3 audio extraction from tracks & sets.',
    accent: '#FF5500',
    accentBg: 'bg-amber-500/10 text-amber-600 border-amber-200/50',
    badge: '320 KBPS',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF5500]">
        <path d="M1.175 12.225c-.051 0-.094.044-.103.1l-.307 2.871.307 2.813c.009.06.052.1.103.1.06 0 .103-.04.112-.1l.342-2.813-.342-2.871a.11.11 0 0 0-.112-.1zm1.096-1.121a.11.11 0 0 0-.112.103l-.283 3.992.283 3.82c.009.06.051.103.112.103.051 0 .094-.043.103-.103l.317-3.82-.317-3.992a.097.097 0 0 0-.103-.103z" />
      </svg>
    ),
  },
  {
    name: 'Bandcamp',
    category: 'Indie Audio & Albums',
    description: 'Lossless audio stream extraction from independent artist releases.',
    accent: '#1DA0C3',
    accentBg: 'bg-cyan-500/10 text-cyan-600 border-cyan-200/50',
    badge: 'LOSSLESS AUDIO',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#1DA0C3]">
        <path d="M0 18.75l7.437-13.5H24l-7.438 13.5z" />
      </svg>
    ),
  },
  {
    name: 'Mixcloud',
    category: 'DJ Sets & Shows',
    description: 'Long-form DJ sets, radio broadcasts, and podcast audio grabbing.',
    accent: '#7C3AED',
    accentBg: 'bg-violet-500/10 text-violet-600 border-violet-200/50',
    badge: 'LONG-FORM AUDIO',
    icon: (
      <div className="w-6 h-6 rounded-md bg-[#5000ff] flex items-center justify-center">
        <span className="text-[10px] font-extrabold text-white leading-none">M·X</span>
      </div>
    ),
  },
];

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

export default function AboutPage() {
  const shouldReduceMotion = useReducedMotion();

  // Animation variants
  const fadeIn = {
    initial: shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-50px' },
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <div className="min-h-screen bg-[#F6F6F8] text-[#0A0A0C] font-sans antialiased selection:bg-violet-500 selection:text-white">
      {/* Global Navbar */}
      <Navbar />

      {/* ===================================================================
          1. HERO SECTION
          =================================================================== */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden bg-radial from-violet-100/40 via-[#F6F6F8] to-[#F6F6F8]">
        {/* Subtle colorful geometric ambient background elements */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-r from-blue-200/20 via-violet-200/30 to-orange-200/20 blur-3xl pointer-events-none rounded-full" />
        <div className="absolute top-40 right-10 w-72 h-72 bg-violet-300/15 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute top-60 left-10 w-64 h-64 bg-blue-300/15 rounded-full blur-2xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            {/* Eyebrow */}
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-50 border border-violet-200/60 text-violet-700 text-xs font-mono font-medium uppercase tracking-widest mb-6"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-600" />
              <span>ABOUT VIDLEO</span>
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="font-display font-extrabold text-5xl sm:text-7xl lg:text-8xl tracking-tight text-[#0A0A0C] leading-[1.04]"
            >
              One place for <br className="hidden sm:inline" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#0A0A0C] via-violet-950 to-[#0A0A0C]">
                all your media.
              </span>
            </motion.h1>

            {/* Supporting Text */}
            <motion.p
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-6 sm:mt-8 text-lg sm:text-xl text-[#5A5A62] max-w-2xl mx-auto leading-relaxed font-normal"
            >
              Vidleo makes it easier to discover, extract, organize, and work with media from the platforms you already use.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-9 flex flex-wrap items-center justify-center gap-4"
            >
              <Link
                href="/download"
                className="bg-[#0A0A0C] text-white hover:bg-neutral-800 rounded-full px-8 py-3.5 text-sm font-medium transition-all duration-200 shadow-md shadow-black/10 flex items-center gap-2 group"
              >
                <span>Explore Vidleo</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200" />
              </Link>
              <Link
                href="/login"
                className="bg-white text-[#0A0A0C] hover:bg-neutral-50 border border-neutral-200/80 hover:border-neutral-300 rounded-full px-8 py-3.5 text-sm font-medium transition-all duration-200 shadow-xs"
              >
                Get Started
              </Link>
            </motion.div>
          </div>

          {/* Decorative subtle platform chips around hero */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mt-16 pt-8 border-t border-black/5 max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-xs font-mono text-neutral-500"
          >
            <span className="text-neutral-400 font-sans text-xs mr-2 font-medium">Supported Workflows:</span>
            {[
              { label: '4K Ultra HD', color: 'bg-blue-50 text-blue-700 border-blue-200/60' },
              { label: 'Lossless Audio', color: 'bg-violet-50 text-violet-700 border-violet-200/60' },
              { label: 'Direct MP4/MP3', color: 'bg-amber-50 text-amber-700 border-amber-200/60' },
              { label: 'Batch Extraction', color: 'bg-pink-50 text-pink-700 border-pink-200/60' },
              { label: 'No Ads & No Loops', color: 'bg-neutral-100 text-neutral-700 border-neutral-200' },
            ].map((chip) => (
              <span
                key={chip.label}
                className={cn(
                  'px-3 py-1 rounded-full border transition-all duration-200',
                  chip.color
                )}
              >
                {chip.label}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ===================================================================
          2. THE STORY SECTION
          =================================================================== */}
      <section className="py-24 bg-white border-y border-neutral-200/60 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="mb-4">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest">
              THE STORY
            </span>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            {/* Left: Large Editorial Headline */}
            <motion.div {...fadeIn} className="lg:col-span-6">
              <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight leading-[1.12]">
                Why Vidleo?
              </h2>
              <p className="mt-4 font-display font-semibold text-2xl sm:text-3xl text-neutral-800 leading-snug">
                "Media is everywhere.{' '}
                <span className="text-violet-600">
                  The problem is getting it where you need it."
                </span>
              </p>
            </motion.div>

            {/* Right: Short Story Content */}
            <motion.div {...fadeIn} className="lg:col-span-6 space-y-5 text-neutral-600 text-base sm:text-lg leading-relaxed">
              <p>
                Creators, teams, researchers, and everyday users work across multiple platforms every single day—constantly switching between different services, single-purpose tools, ad-riddled downloads, and fragmented storage.
              </p>
              <p>
                Vidleo is designed to simplify that workflow by bringing media extraction and management into one unified, clean, and reliable experience. No redirect loops, no compromised resolution, and no friction.
              </p>

              {/* Mini platform visual cards preview */}
              <div className="pt-4 grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-[#F6F6F8] border border-neutral-200/70 hover:border-violet-300 transition-all duration-200 group">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-xs font-semibold text-neutral-900 group-hover:text-violet-600 transition-colors">Video</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 block">YouTube, Vimeo</span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F6F6F8] border border-neutral-200/70 hover:border-violet-300 transition-all duration-200 group">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-pink-500" />
                    <span className="text-xs font-semibold text-neutral-900 group-hover:text-violet-600 transition-colors">Social</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 block">Instagram, X, Reddit</span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F6F6F8] border border-neutral-200/70 hover:border-violet-300 transition-all duration-200 group">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-semibold text-neutral-900 group-hover:text-violet-600 transition-colors">Audio</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 block">SoundCloud, Bandcamp</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          3. THE PROBLEM SECTION (ORGANIC GRID OF PLATFORMS - NO TIKTOK)
          =================================================================== */}
      <section className="py-24 bg-[#F6F6F8] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="max-w-3xl mb-16">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest block mb-2">
              THE PROBLEM
            </span>
            <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight leading-tight">
              Too many platforms. <br />
              <span className="text-neutral-500 font-normal">One messy workflow.</span>
            </h2>
            <p className="mt-4 text-base sm:text-lg text-neutral-600">
              Modern creators spend hours navigating disparate platform silos. Vidleo bridges every source into a single structured engine.
            </p>
          </motion.div>

          {/* Organic Grid Layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PLATFORMS.map((platform, idx) => (
              <motion.div
                key={platform.name}
                initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.05 }}
                className={cn(
                  'group relative bg-white rounded-2xl p-6 border border-neutral-200/80 hover:border-neutral-400 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/5 overflow-hidden flex flex-col justify-between',
                  idx === 0 && 'lg:col-span-2 sm:p-8',
                  idx === 4 && 'sm:col-span-2 lg:col-span-1'
                )}
              >
                {/* Expandable Top Accent Line */}
                <div
                  className="absolute top-0 left-0 right-0 h-1 transition-all duration-300 group-hover:h-1.5"
                  style={{ backgroundColor: platform.accent }}
                />

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-[#F6F6F8] border border-neutral-100 group-hover:scale-110 group-hover:rotate-2 transition-transform duration-300">
                      {platform.icon}
                    </div>
                    <span className={cn('text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full border', platform.accentBg)}>
                      {platform.badge}
                    </span>
                  </div>

                  <h3 className="font-display font-bold text-xl text-[#0A0A0C] group-hover:text-violet-600 transition-colors duration-200">
                    {platform.name}
                  </h3>
                  <span className="text-xs font-mono text-neutral-400 block mb-2">{platform.category}</span>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {platform.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-xs font-medium text-neutral-400 group-hover:text-neutral-900 transition-colors">
                  <span>Seamless Parsing</span>
                  <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================================================================
          4. THE VIDLEO APPROACH SECTION
          =================================================================== */}
      <section className="py-24 bg-white border-y border-neutral-200/60 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="max-w-3xl mb-16">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest block mb-2">
              OUR APPROACH
            </span>
            <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight">
              Built around simplicity.
            </h2>
          </motion.div>

          {/* Three Large Editorial Cards: Blue, Violet, Orange */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 01 - BLUE ACCENT */}
            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="group bg-[#F6F6F8] rounded-3xl p-8 border border-blue-200/60 hover:border-blue-400 transition-all duration-300 relative flex flex-col justify-between hover:-translate-y-1 shadow-xs hover:shadow-lg hover:shadow-blue-500/5"
            >
              <div>
                <div className="flex items-center justify-between mb-8">
                  <span className="font-mono font-bold text-3xl text-blue-600">01</span>
                  <div className="w-10 h-10 rounded-full bg-blue-100/70 text-blue-600 flex items-center justify-center">
                    <Globe className="w-5 h-5" />
                  </div>
                </div>

                <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-600 block mb-2">
                  ONE PLACE
                </span>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#0A0A0C] mb-4 leading-snug">
                  "Bring media from the platforms you already use into one unified workflow."
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Stop juggling separate bookmarked tools for video, music, and social clips. Vidleo acts as a central hub for every stream.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-blue-200/40 text-xs font-mono text-blue-700 font-medium">
                Unified Ecosystem
              </div>
            </motion.div>

            {/* Card 02 - VIOLET ACCENT */}
            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="group bg-[#F6F6F8] rounded-3xl p-8 border border-violet-200/60 hover:border-violet-400 transition-all duration-300 relative flex flex-col justify-between hover:-translate-y-1 shadow-xs hover:shadow-lg hover:shadow-violet-500/5"
            >
              <div>
                <div className="flex items-center justify-between mb-8">
                  <span className="font-mono font-bold text-3xl text-violet-600">02</span>
                  <div className="w-10 h-10 rounded-full bg-violet-100/70 text-violet-600 flex items-center justify-center">
                    <Zap className="w-5 h-5" />
                  </div>
                </div>

                <span className="text-xs font-mono font-bold uppercase tracking-wider text-violet-600 block mb-2">
                  FAST BY DESIGN
                </span>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#0A0A0C] mb-4 leading-snug">
                  "Reduce unnecessary steps and get from source to usable media faster."
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Engineered with light-speed URL resolution, direct stream downloads, and zero ad redirect loops.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-violet-200/40 text-xs font-mono text-violet-700 font-medium">
                High-Performance Core
              </div>
            </motion.div>

            {/* Card 03 - ORANGE ACCENT */}
            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="group bg-[#F6F6F8] rounded-3xl p-8 border border-orange-200/60 hover:border-orange-400 transition-all duration-300 relative flex flex-col justify-between hover:-translate-y-1 shadow-xs hover:shadow-lg hover:shadow-orange-500/5"
            >
              <div>
                <div className="flex items-center justify-between mb-8">
                  <span className="font-mono font-bold text-3xl text-orange-600">03</span>
                  <div className="w-10 h-10 rounded-full bg-orange-100/70 text-orange-600 flex items-center justify-center">
                    <Cpu className="w-5 h-5" />
                  </div>
                </div>

                <span className="text-xs font-mono font-bold uppercase tracking-wider text-orange-600 block mb-2">
                  BUILT TO SCALE
                </span>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#0A0A0C] mb-4 leading-snug">
                  "Designed to grow from individual creators to teams and larger media workflows."
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Whether saving single clips or managing batch production archives, Vidleo scales to high throughput requirements.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-orange-200/40 text-xs font-mono text-orange-700 font-medium">
                Scalable Infrastructure
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          5. WHAT WE BUILD (PRODUCT ECOSYSTEM)
          =================================================================== */}
      <section className="py-24 bg-[#F6F6F8] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="max-w-3xl mb-16">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest block mb-2">
              ECOSYSTEM
            </span>
            <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight">
              More than a downloader.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Main Product Card: VIDLEO */}
            <motion.div
              {...fadeIn}
              className="lg:col-span-7 bg-white rounded-3xl p-8 sm:p-12 border border-neutral-200/80 shadow-xs flex flex-col justify-between relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-violet-100/40 rounded-full blur-3xl pointer-events-none" />

              <div>
                <div className="flex items-center gap-3 mb-6">
                  <VidleoSymbol className="w-8 h-8" />
                  <span className="font-display font-extrabold text-2xl tracking-tight text-[#0A0A0C]">VIDLEO</span>
                  <span className="text-[10px] font-mono font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full uppercase">Main Product</span>
                </div>

                <p className="font-display font-bold text-2xl sm:text-3xl text-neutral-900 leading-snug mb-4">
                  "Media extraction and management for modern digital workflows."
                </p>

                <p className="text-neutral-600 text-base leading-relaxed">
                  Vidleo provides a refined interface for discovering, retrieving, and organizing online video and audio streams across every major platform.
                </p>
              </div>

              <div className="mt-10 pt-6 border-t border-neutral-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-neutral-500">
                  <Check className="w-4 h-4 text-violet-600" />
                  <span>Production Ready</span>
                </div>
                <Link
                  href="/download"
                  className="text-xs font-semibold text-violet-600 hover:text-violet-800 flex items-center gap-1 group"
                >
                  <span>Launch Utility</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </motion.div>

            {/* Parent Ecosystem Card: SYNAPVO TECH */}
            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="lg:col-span-5 bg-[#0A0A0C] text-white rounded-3xl p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden"
            >
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

              <div>
                <div className="flex items-center justify-between mb-6">
                  <span className="font-mono text-xs font-semibold tracking-widest text-neutral-400 uppercase">
                    INFRASTRUCTURE
                  </span>
                  <span className="text-[10px] font-mono text-neutral-400 border border-neutral-800 px-2 py-0.5 rounded-full">
                    Parent Platform
                  </span>
                </div>

                <h3 className="font-display font-extrabold text-2xl sm:text-3xl text-white mb-3 tracking-tight">
                  SYNAPVO TECH
                </h3>

                <p className="text-sm text-neutral-300 leading-relaxed mb-6 font-light">
                  "Technology company building intelligent media and automation infrastructure."
                </p>

                <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 text-xs text-neutral-300 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Ecosystem Products:</span>
                    <a
                      href={EXTERNAL_LINKS.CLIPPER_X}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 hover:underline flex items-center gap-1 font-mono"
                    >
                      ClipperX <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-normal">
                    Advanced stream engine & media routing powering modern browser applications.
                  </p>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-neutral-800 flex items-center justify-between">
                <a
                  href={EXTERNAL_LINKS.SYNAPVO_ECOSYSTEM}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
                >
                  <span>Visit Synapvo</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          6. HOW VIDLEO FITS (HORIZONTAL WORKFLOW)
          =================================================================== */}
      <section className="py-24 bg-white border-y border-neutral-200/60 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="max-w-3xl mb-16">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest block mb-2">
              WORKFLOW PIPELINE
            </span>
            <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight">
              How Vidleo fits.
            </h2>
            <p className="mt-3 text-base text-neutral-600">
              A continuous 4-step sequence from raw online source to finished production asset.
            </p>
          </motion.div>

          {/* Steps Horizontal Flow */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            {[
              {
                step: '01',
                title: 'DISCOVER',
                icon: Compass,
                color: 'text-blue-600 bg-blue-50 border-blue-200/60',
                desc: 'Find videos, podcasts, tracks, or reels across supported platforms.',
              },
              {
                step: '02',
                title: 'EXTRACT',
                icon: Zap,
                color: 'text-violet-600 bg-violet-50 border-violet-200/60',
                desc: 'Parse direct high-speed streams with full resolution options.',
              },
              {
                step: '03',
                title: 'ORGANIZE',
                icon: FolderCheck,
                color: 'text-amber-600 bg-amber-50 border-amber-200/60',
                desc: 'Archive and manage downloaded files into clean structured lists.',
              },
              {
                step: '04',
                title: 'CREATE',
                icon: Sparkles,
                color: 'text-pink-600 bg-pink-50 border-pink-200/60',
                desc: 'Integrate pristine media straight into editing timelines and research.',
              },
            ].map((st, idx) => (
              <motion.div
                key={st.step}
                initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className="bg-[#F6F6F8] rounded-2xl p-6 border border-neutral-200/70 hover:border-neutral-300 transition-all duration-200 relative group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono font-bold text-2xl text-neutral-400 group-hover:text-neutral-900 transition-colors">
                      {st.step}
                    </span>
                    <div className={cn('p-2.5 rounded-xl border', st.color)}>
                      <st.icon className="w-5 h-5" />
                    </div>
                  </div>

                  <h3 className="font-display font-bold text-lg text-[#0A0A0C] mb-2 tracking-wide">
                    {st.title}
                  </h3>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {st.desc}
                  </p>
                </div>

                {idx < 3 && (
                  <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                    <div className="w-6 h-6 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-neutral-400 shadow-xs">
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================================================================
          7. OUR PHILOSOPHY SECTION (LARGE EDITORIAL TYPOGRAPHY)
          =================================================================== */}
      <section className="py-28 bg-[#0A0A0C] text-white relative overflow-hidden">
        {/* Ambient subtle glow background */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-r from-violet-600/20 via-blue-600/10 to-orange-600/20 blur-3xl rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-4xl">
            <motion.div {...fadeIn} className="mb-6">
              <span className="text-xs font-mono font-medium text-violet-400 uppercase tracking-widest border border-violet-500/30 px-3 py-1 rounded-full bg-violet-950/40">
                OUR PHILOSOPHY
              </span>
            </motion.div>

            <motion.h2
              {...fadeIn}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="font-display font-extrabold text-4xl sm:text-6xl lg:text-7xl tracking-tight text-white leading-[1.08]"
            >
              Media should move <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-300 via-white to-orange-200">
                with you.
              </span>
            </motion.h2>

            <motion.p
              {...fadeIn}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-8 text-lg sm:text-2xl text-neutral-300 font-normal leading-relaxed max-w-3xl"
            >
              "Your content shouldn't be trapped behind complicated workflows. Vidleo is built around a simple idea: make media easier to access, move, organize, and use."
            </motion.p>

            <motion.div
              {...fadeIn}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 border-t border-neutral-800"
            >
              <div>
                <span className="font-mono text-xs text-violet-400 font-semibold block mb-1">01 / FREEDOM</span>
                <p className="text-sm text-neutral-400">Zero artificial lock-in or proprietary format constraints.</p>
              </div>
              <div>
                <span className="font-mono text-xs text-blue-400 font-semibold block mb-1">02 / INTEGRITY</span>
                <p className="text-sm text-neutral-400">Pristine source resolution and uncompressed audio.</p>
              </div>
              <div>
                <span className="font-mono text-xs text-orange-400 font-semibold block mb-1">03 / UTILITY</span>
                <p className="text-sm text-neutral-400">Clean interfaces designed for continuous productivity.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          8. THE FUTURE SECTION
          =================================================================== */}
      <section className="py-24 bg-[#F6F6F8] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn} className="max-w-3xl mb-16">
            <span className="text-xs font-mono font-medium text-violet-600 uppercase tracking-widest block mb-2">
              THE FUTURE
            </span>
            <h2 className="font-display font-bold text-3xl sm:text-5xl text-[#0A0A0C] tracking-tight mb-4">
              Where we're going.
            </h2>
            <p className="text-base sm:text-lg text-neutral-600 leading-relaxed">
              Vidleo is evolving from a simple media utility into a broader media infrastructure layer—helping people and teams move from finding media to actually working with it.
            </p>
          </motion.div>

          {/* Three Conceptual Directions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="bg-white rounded-3xl p-8 border border-neutral-200/80 shadow-xs flex flex-col justify-between"
            >
              <div>
                <span className="font-mono font-bold text-sm text-violet-600 block mb-4">01 — DIRECTION</span>
                <h3 className="font-display font-bold text-xl text-[#0A0A0C] mb-3">
                  Smarter Media Workflows
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Intelligent parsing, automatic tagging, and contextual metadata organization to simplify high-volume media collections.
                </p>
              </div>
              <div className="mt-8 pt-4 border-t border-neutral-100 text-xs font-mono text-neutral-400">
                Next-Gen Automation
              </div>
            </motion.div>

            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-white rounded-3xl p-8 border border-neutral-200/80 shadow-xs flex flex-col justify-between"
            >
              <div>
                <span className="font-mono font-bold text-sm text-blue-600 block mb-4">02 — DIRECTION</span>
                <h3 className="font-display font-bold text-xl text-[#0A0A0C] mb-3">
                  Unified Media Infrastructure
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  High-speed global edge extraction and robust media pipeline connectivity built on Synapvo infrastructure.
                </p>
              </div>
              <div className="mt-8 pt-4 border-t border-neutral-100 text-xs font-mono text-neutral-400">
                Infrastructure Layer
              </div>
            </motion.div>

            <motion.div
              {...fadeIn}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="bg-white rounded-3xl p-8 border border-neutral-200/80 shadow-xs flex flex-col justify-between"
            >
              <div>
                <span className="font-mono font-bold text-sm text-orange-600 block mb-4">03 — DIRECTION</span>
                <h3 className="font-display font-bold text-xl text-[#0A0A0C] mb-3">
                  Creator & Team Tools
                </h3>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Shared media workspaces, collaborative asset libraries, export presets, and seamless editing integrations.
                </p>
              </div>
              <div className="mt-8 pt-4 border-t border-neutral-100 text-xs font-mono text-neutral-400">
                Collaboration Suite
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          9. FINAL CTA SECTION
          =================================================================== */}
      <section className="py-20 bg-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            {...fadeIn}
            className="bg-[#0A0A0C] text-white rounded-3xl p-10 sm:p-16 relative overflow-hidden text-center max-w-5xl mx-auto shadow-2xl"
          >
            {/* Subtle blue / violet / orange decorative glows */}
            <div className="absolute -top-24 -left-24 w-72 h-72 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-1/2 right-0 w-80 h-80 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-12 w-64 h-64 bg-orange-600/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="font-display font-extrabold text-3xl sm:text-5xl text-white tracking-tight leading-tight mb-4">
                Ready to work with media differently?
              </h2>

              <p className="text-base sm:text-lg text-neutral-300 mb-8 leading-relaxed font-light">
                Explore Vidleo and see what a simpler media workflow looks like.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/login"
                  className="bg-white text-[#0A0A0C] hover:bg-neutral-100 rounded-full px-8 py-3.5 text-sm font-semibold transition-all duration-200 shadow-md"
                >
                  Get Started
                </Link>
                <Link
                  href="/download"
                  className="bg-neutral-900 text-white hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-full px-8 py-3.5 text-sm font-semibold transition-all duration-200 flex items-center gap-2"
                >
                  <span>Explore Vidleo</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===================================================================
          10. FOOTER
          =================================================================== */}
      <Footer />
    </div>
  );
}
