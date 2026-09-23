'use client';

import React from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditorialPlatformCard {
  id: string;
  name: string;
  category: string;
  badge: string;
  footerText: string;
  artworkUrl: string;
  icon: React.ReactNode;
  gridSpan: string;
}

const PLATFORMS: EditorialPlatformCard[] = [
  {
    id: 'yt',
    name: 'YouTube',
    category: 'Videos, Playlists, Shorts',
    badge: '4K',
    footerText: 'High quality downloads',
    artworkUrl: '/images/card_yt.jpg',
    gridSpan: 'col-span-12 md:col-span-6 lg:col-span-4',
    icon: (
      <svg className="w-5 h-5 fill-[#FF0000]" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    id: 'ig',
    name: 'Instagram',
    category: 'Reels, Videos, Stories',
    badge: 'HD',
    footerText: 'Reels, Stories & more',
    artworkUrl: '/images/card_ig.jpg',
    gridSpan: 'col-span-12 md:col-span-6 lg:col-span-4',
    icon: (
      <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-[#FFD600] via-[#FF0169] to-[#D300C5] flex items-center justify-center shadow-sm">
        <svg className="w-3 h-3 fill-white" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </div>
    ),
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    category: 'Videos & GIFs',
    badge: 'HD',
    footerText: 'Download videos & GIFs',
    artworkUrl: '/images/card_x.jpg',
    gridSpan: 'col-span-12 md:col-span-12 lg:col-span-4',
    icon: (
      <div className="w-5 h-5 rounded-md bg-black border border-white/20 flex items-center justify-center">
        <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>
    ),
  },
  {
    id: 'vm',
    name: 'Vimeo',
    category: 'High Quality Videos',
    badge: 'HD',
    footerText: 'High quality downloads',
    artworkUrl: '/images/card_vm.jpg',
    gridSpan: 'col-span-12 md:col-span-6 lg:col-span-6',
    icon: (
      <div className="w-5 h-5 rounded-md bg-[#1AB7EA] flex items-center justify-center shadow-sm">
        <svg className="w-3 h-3 fill-white" viewBox="0 0 24 24">
          <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128 1.581-1.378 2.764-2.106 3.553-2.18 1.876-.179 3.033 1.096 3.473 3.824.526 3.26 1.006 5.86 1.442 7.799.435 1.939 1.044 2.909 1.826 2.909.608 0 1.524-.963 2.748-2.887 1.224-1.924 1.868-3.414 1.932-4.471.133-1.638-.475-2.457-1.826-2.457-.65 0-1.344.152-2.082.456 1.344-4.398 3.916-6.521 7.718-6.37 2.823.109 4.148 1.934 3.972 5.48z" />
        </svg>
      </div>
    ),
  },
  {
    id: 'rd',
    name: 'Reddit',
    category: 'Videos & Clips',
    badge: 'HD',
    footerText: 'Download videos & clips',
    artworkUrl: '/images/card_rd.jpg',
    gridSpan: 'col-span-12 md:col-span-6 lg:col-span-6',
    icon: (
      <div className="w-5 h-5 rounded-md bg-[#FF4500] flex items-center justify-center shadow-sm">
        <svg className="w-3 h-3 fill-white" viewBox="0 0 24 24">
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      </div>
    ),
  },
];

export function ScrollMorphPlatforms() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hoveredCardId, setHoveredCardId] = React.useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // Gentle scroll parallax across the ONE URL section
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  const forestY = useTransform(
    scrollYProgress,
    [0, 1],
    shouldReduceMotion ? ['0%', '0%'] : ['-4%', '4%']
  );

  return (
    <section
      ref={containerRef}
      id="supported-platforms"
      className="relative w-full pt-24 sm:pt-32 pb-28 sm:pb-36 overflow-hidden selection:bg-[#E2FD52] selection:text-[#0C1812]"
      style={{
        backgroundColor: '#204633',
      }}
    >
      {/* =========================================================
          BRIGHT, AIRY SUNLIT GREEN CANOPY & DAYLIGHT TRANSITION
          ========================================================= */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Soft, vibrant daylight moss emerald base */}
        <div className="absolute inset-0 bg-[#204633]" />

        {/* High-res cinematic sunlit foliage bokeh image with subtle parallax & natural exposure */}
        <motion.div
          style={{ y: forestY }}
          className="absolute inset-0 w-full h-[110%] -top-[5%] transform-gpu will-change-transform"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/forest_bokeh_bg.jpg"
            alt="Sunlit Forest Bokeh"
            className="w-full h-full object-cover object-center opacity-90 filter brightness-110 contrast-100 saturate-110"
            style={{
              maskImage:
                'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 12%, black 30%, black 85%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 12%, black 30%, black 85%, transparent 100%)',
            }}
          />
        </motion.div>

        {/* Soft daylight morning sun wash for open, airy atmosphere */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-white/5 to-transparent pointer-events-none" />

        {/* Seamless Top Atmospheric Connection from Hero Alpine Meadow (NO dark bar) */}
        <div className="absolute top-0 inset-x-0 h-44 bg-gradient-to-b from-[#2A5239]/60 via-transparent to-transparent pointer-events-none" />
        <div className="absolute -top-12 left-1/4 w-[750px] h-[350px] bg-gradient-to-b from-amber-100/25 via-[#B8E600]/15 to-transparent rounded-full blur-[120px] pointer-events-none" />

        {/* Radiant sunbeam dapple lights */}
        <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-[#E2FD52]/15 rounded-full blur-[130px] pointer-events-none" />
        <div className="absolute top-1/2 right-1/4 w-[600px] h-[400px] bg-emerald-300/15 rounded-full blur-[140px] pointer-events-none" />

        {/* Seamless Bottom Blend into warm cream sections below */}
        <div className="absolute bottom-0 inset-x-0 h-44 bg-gradient-to-t from-[#FAF9F5] via-[#204633]/60 to-transparent pointer-events-none" />
      </div>


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-20 w-full">
        
        {/* =========================================================
            MAIN TWO-COLUMN LAYOUT (Heading on Left, Cards on Right)
            ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-start">
          
          {/* -------------------------------------------------------
              LEFT COLUMN: Editorial Heading & Context
              ------------------------------------------------------- */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-5 space-y-6 pt-2 lg:sticky lg:top-32"
          >

            {/* Large White Editorial Headline */}
            <h2 className="font-display font-[800] text-5xl sm:text-6xl md:text-7xl lg:text-[72px] xl:text-[80px] tracking-[-0.04em] text-white leading-[0.93] drop-shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
              ONE URL.<br />
              <span className="italic font-display font-[800] text-white">MANY WAYS.</span>
            </h2>

            {/* Short Supporting Copy */}
            <p className="text-sm sm:text-base md:text-[17px] text-white/85 max-w-md font-sans font-normal leading-relaxed pt-1 drop-shadow-sm">
              One simple URL. Download videos, reels, clips and more from the platforms you already use.
            </p>

            {/* Aesthetic Line Divider */}
            <div className="w-16 h-[1.5px] bg-[#E2FD52]/50 rounded-full pt-1" />
          </motion.div>

          {/* -------------------------------------------------------
              RIGHT COLUMN: Structured Editorial Platform Cards Grid
              ------------------------------------------------------- */}
          <div className="lg:col-span-7">
            <div className="grid grid-cols-12 gap-4 sm:gap-5">
              {PLATFORMS.map((platform, index) => {
                const isHovered = hoveredCardId === platform.id;
                const isAnyHovered = hoveredCardId !== null;
                const isDimmed = isAnyHovered && !isHovered;

                return (
                  <motion.div
                    key={platform.id}
                    initial={
                      shouldReduceMotion
                        ? { opacity: 1, y: 0 }
                        : {
                            opacity: 0,
                            y: 35,
                            rotate: index % 2 === 0 ? -2.5 : 2.5,
                            scale: 0.94,
                          }
                    }
                    whileInView={{
                      opacity: 1,
                      y: 0,
                      rotate: 0,
                      scale: 1,
                    }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{
                      duration: 0.65,
                      delay: shouldReduceMotion ? 0 : index * 0.08,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    onMouseEnter={() => setHoveredCardId(platform.id)}
                    onMouseLeave={() => setHoveredCardId(null)}
                    animate={{
                      opacity: isDimmed ? 0.78 : 1,
                      scale: isHovered ? 1.03 : 1,
                    }}
                    className={cn(
                      'relative group select-none cursor-pointer transform-gpu will-change-transform will-change-opacity',
                      platform.gridSpan
                    )}
                  >
                    <div
                      className={cn(
                        'relative h-full rounded-[22px] sm:rounded-[26px] bg-[#11241A]/85 backdrop-blur-xl border border-white/20 transition-all duration-300 overflow-hidden flex flex-col justify-between',
                        isHovered
                          ? 'border-white/45 shadow-[0_28px_65px_rgba(0,0,0,0.65)] -translate-y-2'
                          : 'shadow-[0_20px_45px_rgba(0,0,0,0.45)]'
                      )}
                    >
                      {/* Atmospheric Illustration Artwork Canvas */}
                      <div className="relative w-full aspect-[4/3] overflow-hidden bg-[#0A1610]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={platform.artworkUrl}
                          alt={platform.name}
                          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 ease-out"
                          loading="lazy"
                        />
                        
                        {/* Top Overlay Gradient for Platform Header Visibility */}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/25 to-transparent pointer-events-none" />

                        {/* Header Overlaid on Artwork */}
                        <div className="absolute top-3.5 left-3.5 right-3.5 flex items-start gap-2.5 z-10">
                          <div className="shrink-0 mt-0.5">
                            {platform.icon}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-display font-[800] text-sm sm:text-[15px] text-white tracking-tight leading-tight drop-shadow-sm">
                              {platform.name}
                            </h3>
                            <p className="text-[10px] text-white/75 font-sans font-medium truncate pt-0.5 drop-shadow-sm">
                              {platform.category}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Action / Metadata Footer */}
                      <div className="p-3.5 sm:p-4 bg-[#0D1C14]/95 border-t border-white/10 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* Quality Badge */}
                          <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-[9.5px] font-mono font-bold text-white uppercase tracking-wider">
                            {platform.badge}
                          </span>
                          {/* Footer Subtext */}
                          <span className="text-[11px] font-sans font-medium text-white/80 line-clamp-1">
                            {platform.footerText}
                          </span>
                        </div>

                        {/* Circular Action Button */}
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white text-[#0A1A12] flex items-center justify-center shrink-0 shadow-md group-hover:bg-[#E2FD52] group-hover:translate-x-1 group-hover:scale-105 transition-all duration-300">
                          <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

        </div>

        {/* =========================================================
            BOTTOM DETAILS BAR
            ========================================================= */}
        <div className="mt-16 sm:mt-20 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-sans">
          {/* Left Status */}
          <div className="flex items-center gap-2 text-white/80">
            <span className="w-2 h-2 rounded-full bg-[#E2FD52] animate-pulse shadow-[0_0_6px_#E2FD52]" />
            <span className="font-mono text-[11px] text-white/90 uppercase tracking-wider font-semibold">
              AUTO-PARSING 1000+ MEDIA PROTOCOLS
            </span>
          </div>

          {/* Right Link */}
          <a
            href="/supported-sites"
            className="inline-flex items-center gap-2 text-[#E2FD52] hover:text-white font-bold text-xs tracking-wider uppercase transition-colors group"
          >
            <span>EXPLORE ALL SUPPORTED SITES</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>

      </div>
    </section>
  );
}
