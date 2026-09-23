'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Search, ArrowRight, ArrowLeft, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Platform Data (TikTok removed) ──────────────────────────────────────────

type PlatformCategory = 'video' | 'social' | 'audio' | 'music';

interface Platform {
  name: string;
  subtitle: string;
  category: PlatformCategory;
  maxRes: string;
  audioOptions: string;
  throughput: string;
  throughputColor: string;
  iconBg: string;
  accentColor: string;  // right panel + glow
  icon: React.ReactNode;
}

const PLATFORMS: Platform[] = [
  {
    name: 'YouTube',
    subtitle: 'Videos, Playlists, Shorts, Channels',
    category: 'video',
    maxRes: '4K (2160p)',
    audioOptions: '320 kbps (MP3)',
    throughput: 'Ultra Fast',
    throughputColor: '#16a34a',
    iconBg: '#FEE2E2',
    accentColor: '#F87171',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF0000]">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    name: 'Vimeo',
    subtitle: 'High Quality Videos & Showcases',
    category: 'video',
    maxRes: '4K UHD / HDR',
    audioOptions: 'Lossless (AAC)',
    throughput: 'Ultra Fast',
    throughputColor: '#16a34a',
    iconBg: '#E0F2FE',
    accentColor: '#38BDF8',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#1AB7EA]">
        <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128 1.581-1.378 2.764-2.106 3.553-2.18 1.876-.179 3.033 1.096 3.473 3.824.526 3.26 1.006 5.86 1.442 7.799.435 1.939 1.044 2.909 1.826 2.909.608 0 1.524-.963 2.748-2.887 1.224-1.924 1.868-3.414 1.932-4.471.133-1.638-.475-2.457-1.826-2.457-.65 0-1.344.152-2.082.456 1.344-4.398 3.916-6.521 7.718-6.37 2.823.109 4.148 1.934 3.972 5.48z" />
      </svg>
    ),
  },
  {
    name: 'Dailymotion',
    subtitle: 'Videos & Channels',
    category: 'video',
    maxRes: '1080p (Full HD)',
    audioOptions: '192 kbps (MP3)',
    throughput: 'Fast',
    throughputColor: '#2563eb',
    iconBg: '#1E293B',
    accentColor: '#334155',
    icon: (
      <span className="font-extrabold text-[20px] text-white italic leading-none">d</span>
    ),
  },
  {
    name: 'Twitch Clips & VODs',
    subtitle: 'Clips, Highlights, Past Broadcasts',
    category: 'video',
    maxRes: '1080p (60fps)',
    audioOptions: 'Source (AAC)',
    throughput: 'Ultra Fast',
    throughputColor: '#16a34a',
    iconBg: '#EDE9FE',
    accentColor: '#8B5CF6',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#9146FF]">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </svg>
    ),
  },
  {
    name: 'Bilibili',
    subtitle: 'Videos, Anime, Channels',
    category: 'video',
    maxRes: '1080p (60fps)',
    audioOptions: 'High Quality',
    throughput: 'Fast',
    throughputColor: '#2563eb',
    iconBg: '#FCE7F3',
    accentColor: '#EC4899',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#00A1D6]">
        <path d="M17.813 4.653h.854c1.51 0 2.769.84 3.298 2.05.33.755.435 1.545.435 2.378v8.691c0 1.259-.444 2.355-1.332 3.29-.888.934-1.954 1.401-3.197 1.401H6.13c-1.242 0-2.309-.467-3.197-1.401-.888-.935-1.332-2.031-1.332-3.29V9.081c0-.833.105-1.623.435-2.378.53-1.21 1.788-2.05 3.298-2.05h.854L4.85 2.12a.854.854 0 0 1 .235-1.196.862.862 0 0 1 1.199.234l2.483 3.495h6.466l2.483-3.495a.862.862 0 0 1 1.199-.234.854.854 0 0 1 .235 1.196l-1.337 2.533zM7.527 10.609c-.66 0-1.196.536-1.196 1.196v2.393c0 .66.536 1.196 1.196 1.196s1.196-.536 1.196-1.196v-2.393c0-.66-.536-1.196-1.196-1.196zm8.946 0c-.66 0-1.196.536-1.196 1.196v2.393c0 .66.536 1.196 1.196 1.196s1.196-.536 1.196-1.196v-2.393c0-.66-.536-1.196-1.196-1.196z" />
      </svg>
    ),
  },
  {
    name: 'Instagram (Reels & Posts)',
    subtitle: 'Reels, Posts, Stories, IGTV',
    category: 'social',
    maxRes: '1080p (HD)',
    audioOptions: 'Stereo (AAC)',
    throughput: 'Instant',
    throughputColor: '#16a34a',
    iconBg: '#FEF3C7',
    accentColor: '#F59E0B',
    icon: (
      <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </div>
    ),
  },
  {
    name: 'X (Twitter)',
    subtitle: 'Videos, GIFs, Tweets',
    category: 'social',
    maxRes: '1080p (Full HD)',
    audioOptions: 'Direct (M4A)',
    throughput: 'Instant',
    throughputColor: '#16a34a',
    iconBg: '#0A0A0C',
    accentColor: '#374151',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: 'Reddit',
    subtitle: 'Videos, GIFs, Posts',
    category: 'social',
    maxRes: '1080p (FHD)',
    audioOptions: 'Synced (MP3)',
    throughput: 'Fast',
    throughputColor: '#2563eb',
    iconBg: '#FFF7ED',
    accentColor: '#F97316',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF4500]">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
      </svg>
    ),
  },
  {
    name: 'Pinterest Video',
    subtitle: 'Pins, Idea Videos',
    category: 'social',
    maxRes: '1080p (FHD)',
    audioOptions: 'Original Audio',
    throughput: 'Instant',
    throughputColor: '#16a34a',
    iconBg: '#FEE2E2',
    accentColor: '#F43F5E',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#E60023]">
        <path d="M12 0a12 12 0 0 0-4.37 23.17c-.07-.63-.13-1.6.03-2.29.14-.62.92-3.88.92-3.88s-.24-.47-.24-1.17c0-1.1.64-1.92 1.44-1.92.68 0 1 .51 1 1.12 0 .68-.43 1.7-.66 2.64-.19.79.4 1.44 1.18 1.44 1.41 0 2.5-1.49 2.5-3.64 0-1.9-1.37-3.23-3.32-3.23-2.26 0-3.59 1.7-3.59 3.45 0 .68.26 1.42.59 1.81.06.08.07.15.05.24-.07.28-.22.9-.25 1.03-.04.17-.14.21-.32.13-1.19-.55-1.93-2.28-1.93-3.67 0-2.98 2.17-5.72 6.26-5.72 3.28 0 5.84 2.34 5.84 5.47 0 3.26-2.06 5.89-4.91 5.89-.96 0-1.86-.5-2.17-1.09l-.59 2.25c-.21.83-.79 1.86-1.18 2.49A12 12 0 1 0 12 0z" />
      </svg>
    ),
  },
  {
    name: 'SoundCloud',
    subtitle: 'Music, Tracks, Playlists',
    category: 'audio',
    maxRes: '320 kbps (MP3)',
    audioOptions: 'Lossless (FLAC)',
    throughput: 'Ultra Fast',
    throughputColor: '#16a34a',
    iconBg: '#FFF7ED',
    accentColor: '#FB923C',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#FF5500]">
        <path d="M1.175 12.225c-.051 0-.094.044-.103.1l-.307 2.871.307 2.813c.009.06.052.1.103.1.06 0 .103-.04.112-.1l.342-2.813-.342-2.871a.11.11 0 0 0-.112-.1zm1.096-1.121a.11.11 0 0 0-.112.103l-.283 3.992.283 3.82c.009.06.051.103.112.103.051 0 .094-.043.103-.103l.317-3.82-.317-3.992a.097.097 0 0 0-.103-.103zm1.101-.44a.13.13 0 0 0-.13.127l-.257 4.432.257 4.19a.13.13 0 0 0 .13.127c.072 0 .13-.057.138-.127l.289-4.19-.289-4.432a.13.13 0 0 0-.138-.127zm1.108-.386a.152.152 0 0 0-.152.149l-.23 4.818.23 4.132a.152.152 0 1 0 .303 0l.261-4.132-.261-4.818a.152.152 0 0 0-.151-.149zm1.115-.185a.175.175 0 0 0-.175.172l-.204 5.003.204 4.056a.175.175 0 1 0 .35 0l.231-4.056-.231-5.003a.175.175 0 0 0-.176-.172zm1.114-.154a.195.195 0 0 0-.195.191L6.2 15.224l.214 3.97a.195.195 0 1 0 .39 0l.243-3.97-.243-5.089a.195.195 0 0 0-.195-.191zm1.114-.101a.217.217 0 0 0-.217.213l-.188 5.19.188 3.883a.217.217 0 1 0 .434 0l.214-3.883-.214-5.19a.217.217 0 0 0-.217-.213zm2.23-.039C10.098 9.8 9.824 9.6 9.5 9.6c-.328 0-.616.204-.73.517-.203.575-.203.9-.203 4.907s0 4.332.203 4.907c.114.313.402.517.73.517.324 0 .607-.201.721-.51l.272-4.914-.272-4.914a.769.769 0 0 0-.691-.51zm1.44-.47c-.377 0-.699.26-.775.63l-.252 5.384.252 4.856a.793.793 0 1 0 1.584 0l.284-4.856-.284-5.384a.793.793 0 0 0-.808-.63zm1.441.057a.87.87 0 0 0-.87.87l-.23 5.327.23 4.797a.87.87 0 1 0 1.739 0l.26-4.797-.26-5.327a.87.87 0 0 0-.869-.87zm1.44-.184a.948.948 0 0 0-.948.947l-.208 5.511.208 4.738a.948.948 0 1 0 1.896 0l.235-4.738-.235-5.511a.948.948 0 0 0-.948-.947zm1.44.068a1.023 1.023 0 0 0-1.023 1.024l-.186 5.443.186 4.67a1.023 1.023 0 1 0 2.046 0l.211-4.67-.211-5.443A1.023 1.023 0 0 0 14.83 9.47zm1.44.348a1.1 1.1 0 0 0-1.1 1.1l-.163 5.095.163 4.601a1.1 1.1 0 1 0 2.2 0l.185-4.601-.185-5.095a1.1 1.1 0 0 0-1.1-1.1zm1.44.573a1.177 1.177 0 0 0-1.177 1.176l-.14 4.522.14 4.531a1.177 1.177 0 1 0 2.354 0l.158-4.531-.158-4.522a1.177 1.177 0 0 0-1.177-1.176zm1.44.812a1.253 1.253 0 0 0-1.253 1.252l-.118 3.71.118 4.461a1.253 1.253 0 1 0 2.506 0l.134-4.461-.134-3.71a1.253 1.253 0 0 0-1.253-1.252zm1.44 1.06a1.33 1.33 0 0 0-1.33 1.33l-.095 2.65.095 4.39a1.33 1.33 0 1 0 2.66 0l.107-4.39-.107-2.65a1.33 1.33 0 0 0-1.33-1.33zm1.44 1.32a1.406 1.406 0 0 0-1.406 1.406l-.073 1.33.073 4.318a1.406 1.406 0 1 0 2.813 0l.082-4.318-.082-1.33a1.406 1.406 0 0 0-1.407-1.406z" />
      </svg>
    ),
  },
  {
    name: 'Bandcamp',
    subtitle: 'Albums, Tracks',
    category: 'music',
    maxRes: 'FLAC / 320kbps',
    audioOptions: 'Lossless Audio',
    throughput: 'Ultra Fast',
    throughputColor: '#16a34a',
    iconBg: '#CFFAFE',
    accentColor: '#06B6D4',
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#1da0c3]">
        <path d="M0 18.75l7.437-13.5H24l-7.438 13.5z" />
      </svg>
    ),
  },
  {
    name: 'Mixcloud',
    subtitle: 'DJ Sets, Radio Shows',
    category: 'music',
    maxRes: '320 kbps (Stream)',
    audioOptions: 'DJ Sets & Shows',
    throughput: 'Fast',
    throughputColor: '#2563eb',
    iconBg: '#EDE9FE',
    accentColor: '#7C3AED',
    icon: (
      <div className="w-6 h-6 rounded-md bg-[#5000ff] flex items-center justify-center">
        <span className="text-[11px] font-extrabold text-white leading-none">M·X</span>
      </div>
    ),
  },
];

// ─── Accent sequences matching spec ──────────────────────────────────────────

// Already defined per-platform above in accentColor field.

// ─── Platform Card Component ──────────────────────────────────────────────────

function PlatformCard({ platform, index }: { platform: Platform; index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || shouldReduceMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty('--mouse-x', `${x}px`);
    cardRef.current.style.setProperty('--mouse-y', `${y}px`);
  }, [shouldReduceMotion]);

  const num = String(index + 1).padStart(2, '0');

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{
        duration: 0.5,
        delay: index * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        className="platform-card group relative flex rounded-[22px] overflow-hidden h-full"
        style={{
          background: '#FFFFFF',
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 12px 35px rgba(30,40,60,0.08)',
          transition: 'all 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Mouse spotlight overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), ${platform.accentColor}14 0%, transparent 55%)`,
            zIndex: 1,
          }}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col p-5 relative z-10">
          {/* Top: icon + name + subtitle */}
          <div className="flex items-start gap-3.5 mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105"
              style={{ backgroundColor: platform.iconBg }}
            >
              {platform.icon}
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-[750] text-[15px] text-[#0A0A0C] tracking-tight leading-tight truncate">
                {platform.name}
              </h3>
              <p className="text-[11.5px] text-[#7A7A82] font-sans leading-snug mt-0.5">
                {platform.subtitle}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-black/[0.06] mb-4" />

          {/* Specs */}
          <div className="space-y-2 mt-auto">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-[#9A9AA2] font-sans">Max Resolution</span>
              <span className="text-[11.5px] font-[650] text-[#0A0A0C] font-mono">{platform.maxRes}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-[#9A9AA2] font-sans">Audio Options</span>
              <span className="text-[11.5px] font-[650] text-[#0A0A0C] font-mono">{platform.audioOptions}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-[#9A9AA2] font-sans">Throughput</span>
              <span className="text-[11.5px] font-[750] font-mono" style={{ color: platform.throughputColor }}>
                {platform.throughput}
              </span>
            </div>
          </div>
        </div>

        {/* Right numbered panel */}
        <div
          className="relative flex flex-col items-center justify-center w-[50px] shrink-0 transition-all duration-400 group-hover:w-[56px]"
          style={{
            background: platform.accentColor,
          }}
        >
          {/* Inner highlight */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, transparent 60%)',
            }}
          />
          <span
            className="relative z-10 text-white font-extrabold text-[16px] tracking-tight select-none"
            style={{ writingMode: 'horizontal-tb', letterSpacing: '-0.02em' }}
          >
            {num}
          </span>
        </div>

        {/* Hover state: glow ring */}
        <div
          className="pointer-events-none absolute inset-0 rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-400"
          style={{
            boxShadow: `0 0 0 1.5px ${platform.accentColor}50, 0 20px 50px ${platform.accentColor}22`,
          }}
        />

        {/* Hover lift is handled via CSS below via global style */}
      </div>
    </motion.div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25 }}
      className="col-span-full flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-[#F4F4F6] border border-black/[0.06] flex items-center justify-center mb-4">
        <Search className="w-6 h-6 text-[#9A9AA2]" />
      </div>
      <p className="font-display font-[700] text-[18px] text-[#0A0A0C] mb-1">No platform found</p>
      <p className="text-[13px] text-[#9A9AA2] font-sans">
        No results for <span className="font-semibold text-[#4A4A52]">&ldquo;{query}&rdquo;</span>
      </p>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CATEGORY_TABS: { id: 'all' | PlatformCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'social', label: 'Social' },
  { id: 'audio', label: 'Audio' },
  { id: 'music', label: 'Music' },
];

export default function SupportedSitesPage() {
  const [activeCategory, setActiveCategory] = useState<'all' | PlatformCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const shouldReduceMotion = useReducedMotion();

  const filteredPlatforms = useMemo(() => {
    return PLATFORMS.filter((p) => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.maxRes.toLowerCase().includes(q) ||
        p.audioOptions.toLowerCase().includes(q) ||
        p.throughput.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <>
      {/* Card hover lift global style */}
      <style>{`
        .platform-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 22px 55px rgba(30,40,60,0.14) !important;
        }
      `}</style>

      <div className="min-h-screen bg-[#F2F3F7] text-[#0A0A0C] flex flex-col font-sans antialiased selection:bg-[#0A0A0C] selection:text-white">
        <Navbar />

        <main className="flex-1 pb-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">

            {/* ── Back to Home ── */}
            <div className="pt-5">
              <a
                href="/"
                className="inline-flex items-center gap-2 text-[13px] font-[600] text-[#5A5A62] hover:text-[#0A0A0C] transition-colors group"
              >
                <span className="w-7 h-7 rounded-full bg-white border border-black/[0.08] shadow-sm flex items-center justify-center group-hover:shadow-md group-hover:border-black/[0.15] transition-all">
                  <ArrowLeft className="w-3.5 h-3.5" />
                </span>
                Back to Home
              </a>
            </div>

            {/* ── Section Header ── */}
            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white border border-black/[0.08] shadow-sm">
                <span className="w-2 h-2 rounded-full bg-[#5B4BFF]" />
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#5A5A62]">
                  SUPPORTED PLATFORMS
                </span>
              </div>

              <h1 className="font-display font-[850] text-4xl sm:text-5xl lg:text-[56px] text-[#0A0A0C] tracking-[-0.035em] leading-[1.0]">
                Download from 50+ platforms
              </h1>

              <p className="text-[15px] sm:text-base text-[#6A6A72] font-sans leading-relaxed max-w-xl mx-auto">
                Your content. No limits. High quality. Blazing fast.
              </p>

              {/* Platform count */}
              <div className="inline-flex items-center gap-2 text-[12px] font-mono text-[#9A9AA2]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                {filteredPlatforms.length} of {PLATFORMS.length} platforms shown
              </div>
            </div>

            {/* ── Search + Filters ── */}
            <div className="bg-white rounded-2xl border border-black/[0.07] shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#9A9AA2] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search platforms..."
                  className="w-full bg-[#F6F6F8] border border-black/[0.06] focus:border-[#5B4BFF]/50 rounded-xl pl-10 pr-9 py-2.5 text-[13px] text-[#0A0A0C] placeholder:text-[#9A9AA2] focus:outline-none font-sans transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9A9AA2] hover:text-black transition-colors"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Category tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 shrink-0">
                {CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className={cn(
                      'px-4 py-2 rounded-xl text-[12.5px] font-[600] tracking-tight whitespace-nowrap transition-all duration-200 cursor-pointer select-none',
                      activeCategory === tab.id
                        ? 'bg-[#0A0A0C] text-white shadow-sm'
                        : 'bg-[#F6F6F8] text-[#6A6A72] hover:text-[#0A0A0C] hover:bg-[#EDEDF0]'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Platform Grid ── */}
            <AnimatePresence mode="sync">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredPlatforms.length === 0 ? (
                  <EmptyState key="empty" query={searchQuery} />
                ) : (
                  filteredPlatforms.map((platform, index) => (
                    <PlatformCard
                      key={platform.name}
                      platform={platform}
                      index={PLATFORMS.indexOf(platform)}
                    />
                  ))
                )}
              </div>
            </AnimatePresence>

            {/* ── Bottom CTA Banner ── */}
            <div className="rounded-[28px] bg-[#0A0A0C] text-white p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-xl overflow-hidden relative">
              <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                  backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
                  backgroundSize: '28px 28px',
                }}
              />
              <div className="space-y-1.5 relative z-10 max-w-xl">
                <h3 className="font-display font-[800] text-2xl sm:text-3xl text-white tracking-tight">
                  Ready to extract from any platform?
                </h3>
                <p className="text-sm text-white/55 font-sans">
                  Paste any supported link into the downloader and get uncompressed media in seconds.
                </p>
              </div>
              <a
                href="/download"
                className="relative z-10 inline-flex items-center gap-2.5 bg-white hover:bg-white/90 text-black px-7 py-3.5 rounded-2xl font-[700] text-[13px] tracking-tight transition-all shadow-md shrink-0 group"
              >
                <span>Launch App</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>

          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
