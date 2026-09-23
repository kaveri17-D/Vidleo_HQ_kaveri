'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PlatformItem } from '@/components/sections/PlatformCard';
import { PlatformMarquee } from '@/components/sections/PlatformMarquee';

// Row 1 Platforms
const ROW_1: PlatformItem[] = [
  {
    id: 'yt',
    name: 'YouTube',
    description: 'Download videos, music, playlists and more in high quality.',
    accentGlow: 'rgba(239, 68, 68, 0.35)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
    bgColor: 'bg-[#181112]/90',
    iconBg: 'bg-[#FF0000]',
    imageUrl: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    id: 'ig',
    name: 'Instagram',
    description: 'Download reels, posts, stories and more in lossless quality.',
    accentGlow: 'rgba(34, 197, 94, 0.35)',
    borderColor: 'rgba(34, 197, 94, 0.45)',
    bgColor: 'bg-[#0E1712]/90',
    iconBg: 'bg-black border border-green-500/40',
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    description: 'Save videos from X in high quality, easily.',
    accentGlow: 'rgba(236, 72, 153, 0.35)',
    borderColor: 'rgba(236, 72, 153, 0.45)',
    bgColor: 'bg-[#181016]/90',
    iconBg: 'bg-black border border-pink-500/40',
    imageUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
];

// Row 2 Platforms
const ROW_2: PlatformItem[] = [
  {
    id: 'vm',
    name: 'Vimeo',
    description: 'Download high-quality videos from creators on Vimeo.',
    accentGlow: 'rgba(99, 102, 241, 0.35)',
    borderColor: 'rgba(99, 102, 241, 0.45)',
    bgColor: 'bg-[#12121D]/90',
    iconBg: 'bg-[#1AB7EA]',
    imageUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128 1.581-1.378 2.764-2.106 3.553-2.18 1.876-.179 3.033 1.096 3.473 3.824.526 3.26 1.006 5.86 1.442 7.799.435 1.939 1.044 2.909 1.826 2.909.608 0 1.524-.963 2.748-2.887 1.224-1.924 1.868-3.414 1.932-4.471.133-1.638-.475-2.457-1.826-2.457-.65 0-1.344.152-2.082.456 1.344-4.398 3.916-6.521 7.718-6.37 2.823.109 4.148 1.934 3.972 5.48z"/>
      </svg>
    ),
  },
  {
    id: 'rd',
    name: 'Reddit',
    description: 'Save interesting videos and clips from Reddit with audio.',
    accentGlow: 'rgba(234, 179, 8, 0.35)',
    borderColor: 'rgba(234, 179, 8, 0.45)',
    bgColor: 'bg-[#18160E]/90',
    iconBg: 'bg-[#FF4500]',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z"/>
      </svg>
    ),
  },
  {
    id: 'sc',
    name: 'SoundCloud',
    description: 'Download and convert audio tracks with ease in studio 320kbps.',
    accentGlow: 'rgba(249, 115, 22, 0.35)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
    bgColor: 'bg-[#18130E]/90',
    iconBg: 'bg-[#FF5500]',
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M1.175 12.225c-.062 0-.112.05-.112.112v4.888c0 .062.05.112.112.112.063 0 .113-.05.113-.112v-4.888c0-.063-.05-.113-.113-.113zm1.125-.975c-.063 0-.113.05-.113.112v6.825c0 .063.05.113.113.113.062 0 .112-.05.112-.113v-6.825c0-.063-.05-.113-.112-.113zm1.125-.75c-.063 0-.113.05-.113.113v8.325c0 .062.05.112.113.112.062 0 .112-.05.112-.112v-8.325c0-.063-.05-.113-.112-.113zm1.125-.6c-.063 0-.113.05-.113.113v9.525c0 .062.05.112.113.112.062 0 .112-.05.112-.112v-9.525c0-.063-.05-.113-.112-.113zm1.125-.225c-.063 0-.113.05-.113.113v10.05c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.8c0-.063-.05-.113-.112-.113zm1.125-.375c-.063 0-.113.05-.113.113v10.8c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.425c0-.063-.05-.113-.112-.113zm1.125-.15c-.063 0-.113.05-.113.113v11.1c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.275c0-.063-.05-.113-.112-.113zm1.125-.075c-.063 0-.113.05-.113.113v11.25c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.2c0-.063-.05-.113-.112-.113zm1.125.15c-.063 0-.113.05-.113.113v10.95c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.35c0-.063-.05-.113-.112-.113zm1.125.375c-.063 0-.113.05-.113.113v10.2c0 .062.05.112.113.112.062 0 .112-.05.112-.112V9.725c0-.063-.05-.113-.112-.113zm2.55-3.075c-.262 0-.525.038-.75.113-.15.037-.225.187-.225.337v13.05c0 .113.075.188.188.188h9.075c2.325 0 4.2-1.875 4.2-4.2s-1.875-4.2-4.2-4.2c-.3 0-.6.038-.9.113C18.425 7.4 16.4 5.75 14.075 5.75c-.525 0-1.013.075-1.5.263z"/>
      </svg>
    ),
  },
  {
    id: 'fb',
    name: 'Facebook',
    description: 'Download public videos from Facebook quickly and in high res.',
    accentGlow: 'rgba(59, 130, 246, 0.35)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
    bgColor: 'bg-[#0E121A]/90',
    iconBg: 'bg-[#1877F2]',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
];

// Row 3 Platforms
const ROW_3: PlatformItem[] = [
  {
    id: 'dm',
    name: 'Dailymotion',
    description: 'Save and convert videos from Dailymotion in high quality.',
    accentGlow: 'rgba(16, 185, 129, 0.35)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
    bgColor: 'bg-[#0E1714]/90',
    iconBg: 'bg-[#0066DC]',
    imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <span className="font-display font-black text-xl text-white lowercase">d</span>
    ),
  },
  {
    id: 'tw',
    name: 'Twitch',
    description: 'Download past broadcasts, highlights and clips seamlessly.',
    accentGlow: 'rgba(217, 70, 239, 0.35)',
    borderColor: 'rgba(217, 70, 239, 0.45)',
    bgColor: 'bg-[#180E1A]/90',
    iconBg: 'bg-[#9146FF]',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
      </svg>
    ),
  },
  {
    id: 'bl',
    name: 'Bilibili',
    description: 'Save your favorite Bilibili videos in high quality & 60fps.',
    accentGlow: 'rgba(56, 189, 248, 0.35)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
    bgColor: 'bg-[#0E151C]/90',
    iconBg: 'bg-[#00A1D6]',
    imageUrl: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <span className="font-display font-black text-sm text-white">bili</span>
    ),
  },
  {
    id: 'more',
    name: 'More Platforms',
    description: "We're constantly adding support for more platforms.",
    ctaText: 'Request a Platform →',
    ctaHref: '/supported-sites',
    isSpecial: true,
    accentGlow: 'rgba(226, 253, 82, 0.4)',
    borderColor: 'rgba(226, 253, 82, 0.6)',
    bgColor: 'bg-[#17180F]/95',
    iconBg: 'bg-[#1E1E14] border border-accent/60',
    imageUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=500&auto=format&fit=crop',
    iconSvg: (
      <span className="text-accent text-xl font-black">+</span>
    ),
  },
];

export function PlatformRail() {
  return (
    <section className="py-24 border-t border-white/[0.06] bg-[#090909] relative overflow-hidden bg-cinema-grid">
      {/* Subtle ambient lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-accent/[0.015] rounded-full blur-[150px] pointer-events-none" />

      {/* Section Header Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-14 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3">

            {/* Powerful Editorial Headline */}
            <h2 className="font-display font-[780] text-4xl sm:text-6xl lg:text-[76px] text-foreground tracking-[-0.04em] leading-[0.95]">
              ONE URL.<br />
              <span className="italic font-display font-[780] text-muted-light">MANY WAYS.</span>
            </h2>

            {/* Supporting line */}
            <p className="text-sm sm:text-base md:text-lg text-muted max-w-xl font-sans font-normal leading-relaxed pt-1">
              One simple link. Download videos, reels, clips and more from the platforms you already use.
            </p>
          </div>

          {/* Top Right Editorial Callout */}
          <div className="hidden md:flex flex-col items-end text-right space-y-1 text-xs font-sans text-muted pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full border border-amber-400" />
              <span className="font-mono text-[11px] text-muted-light uppercase tracking-wider font-semibold">
                SAME LINK.
              </span>
            </div>
            <span className="font-mono text-[11px] text-muted uppercase tracking-wider">
              MORE POSSIBILITIES.
            </span>
            <span className="font-mono text-[10px] text-accent uppercase tracking-wider font-semibold">
              BUILT FOR CREATORS.
            </span>
          </div>
        </div>
      </div>

      {/* Moving Platform Grid with Edge Masking */}
      <div className="relative w-full space-y-4 sm:space-y-6 mask-marquee-edges overflow-hidden z-10">
        {/* Row 1: LEFT -> RIGHT (38s) */}
        <PlatformMarquee
          items={ROW_1}
          direction="left"
          speedClass="animate-marquee-left-38s"
        />

        {/* Row 2: RIGHT -> LEFT (45s) */}
        <PlatformMarquee
          items={ROW_2}
          direction="right"
          speedClass="animate-marquee-right-45s"
        />

        {/* Row 3: LEFT -> RIGHT (42s) */}
        <PlatformMarquee
          items={ROW_3}
          direction="left"
          speedClass="animate-marquee-left-42s"
        />
      </div>

      {/* Section Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t border-white/[0.04] flex items-center justify-between relative z-10">
        {/* Left: See all supported sites link */}
        <a
          href="/supported-sites"
          className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-sans font-semibold tracking-wide text-foreground hover:text-accent transition-colors group"
        >
          <div className="w-7 h-7 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center group-hover:border-accent/40 group-hover:bg-accent/10 transition-colors">
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <span className="font-mono uppercase text-[11px] sm:text-xs tracking-wider">
            SEE ALL SUPPORTED SITES →
          </span>
        </a>

        {/* Right: Editorial script note */}
        <span className="text-xs sm:text-sm font-display italic text-muted-light">
          More to come.
        </span>
      </div>
    </section>
  );
}
