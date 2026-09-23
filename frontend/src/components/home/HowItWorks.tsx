'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link2, Scan, Download, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// VECTOR GEOMETRIC HEADER PATTERNS (Direct Reference Match)
// Card 01: Yellow + Lavender Diagonal Stripes Pattern
// Card 02: Pink + Orange Repeating Semicircles Pattern
// Card 03: Lavender + Yellow Modular Pixel Block Pattern
// ============================================================================

function PatternStripeDiagonal() {
  return (
    <svg className="w-full h-full object-cover" viewBox="0 0 360 140" preserveAspectRatio="none" fill="none">
      {/* Base warm yellow */}
      <rect width="360" height="140" fill="#FEE359" />
      {/* Lavender diagonal thick stripes */}
      <g fill="#B89FE8">
        <path d="M-40 0 L40 140 L0 140 L-80 0 Z" />
        <path d="M40 0 L120 140 L80 140 L0 0 Z" />
        <path d="M120 0 L200 140 L160 140 L80 0 Z" />
        <path d="M200 0 L280 140 L240 140 L160 0 Z" />
        <path d="M280 0 L360 140 L320 140 L240 0 Z" />
        <path d="M360 0 L440 140 L400 140 L320 0 Z" />
      </g>
    </svg>
  );
}

function PatternSemicircles() {
  return (
    <svg className="w-full h-full object-cover" viewBox="0 0 360 140" preserveAspectRatio="none" fill="none">
      {/* Base vivid pink */}
      <rect width="360" height="140" fill="#FF5398" />
      {/* Repeating orange semicircles */}
      <g fill="#FF6534">
        {/* Row 1 */}
        <path d="M 15 35 A 25 25 0 0 0 65 35 Z" />
        <path d="M 75 35 A 25 25 0 0 1 125 35 Z" />
        <path d="M 135 35 A 25 25 0 0 0 185 35 Z" />
        <path d="M 195 35 A 25 25 0 0 1 245 35 Z" />
        <path d="M 255 35 A 25 25 0 0 0 305 35 Z" />
        <path d="M 315 35 A 25 25 0 0 1 365 35 Z" />
        
        {/* Row 2 */}
        <path d="M -15 95 A 25 25 0 0 1 35 95 Z" />
        <path d="M 45 95 A 25 25 0 0 0 95 95 Z" />
        <path d="M 105 95 A 25 25 0 0 1 155 95 Z" />
        <path d="M 165 95 A 25 25 0 0 0 215 95 Z" />
        <path d="M 225 95 A 25 25 0 0 1 275 95 Z" />
        <path d="M 285 95 A 25 25 0 0 0 335 95 Z" />
        <path d="M 345 95 A 25 25 0 0 1 395 95 Z" />
      </g>
    </svg>
  );
}

function PatternPixelBlocks() {
  return (
    <svg className="w-full h-full object-cover" viewBox="0 0 360 140" preserveAspectRatio="none" fill="none">
      {/* Base lavender */}
      <rect width="360" height="140" fill="#B89FE8" />
      {/* Stepped yellow pixel blocks */}
      <g fill="#FEE359">
        {/* Staggered checker steps */}
        <rect x="10" y="10" width="28" height="28" />
        <rect x="38" y="38" width="28" height="28" />
        <rect x="66" y="10" width="28" height="28" />
        <rect x="94" y="38" width="28" height="28" />
        <rect x="122" y="10" width="28" height="28" />
        <rect x="150" y="38" width="28" height="28" />
        <rect x="178" y="10" width="28" height="28" />
        <rect x="206" y="38" width="28" height="28" />
        <rect x="234" y="10" width="28" height="28" />
        <rect x="262" y="38" width="28" height="28" />
        <rect x="290" y="10" width="28" height="28" />
        <rect x="318" y="38" width="28" height="28" />

        {/* Lower tier */}
        <rect x="20" y="76" width="28" height="28" />
        <rect x="48" y="104" width="28" height="28" />
        <rect x="76" y="76" width="28" height="28" />
        <rect x="104" y="104" width="28" height="28" />
        <rect x="132" y="76" width="28" height="28" />
        <rect x="160" y="104" width="28" height="28" />
        <rect x="188" y="76" width="28" height="28" />
        <rect x="216" y="104" width="28" height="28" />
        <rect x="244" y="76" width="28" height="28" />
        <rect x="272" y="104" width="28" height="28" />
        <rect x="300" y="76" width="28" height="28" />
        <rect x="328" y="104" width="28" height="28" />
      </g>
    </svg>
  );
}

// 3 Steps Data Configuration
const STEPS = [
  {
    number: '01',
    label: 'INPUT',
    sticker: 'ANY LINK',
    stickerRotation: 'rotate-[8deg]',
    title: 'Paste Your Link',
    description: 'Drop any public video URL from YouTube, Instagram, Vimeo, X, or Reddit into the input field.',
    badge: 'CLIPBOARD AUTO-DETECT',
    icon: Link2,
    renderPattern: () => <PatternStripeDiagonal />,
  },
  {
    number: '02',
    label: 'PARSE',
    sticker: 'INSPECT',
    stickerRotation: 'rotate-[-6deg]',
    title: 'Select Format & Quality',
    description: 'Inspect the live stream manifest and choose from 4K, 1080p, 720p or audio formats.',
    badge: 'DYNAMIC CODEC PROBE',
    icon: Scan,
    renderPattern: () => <PatternSemicircles />,
  },
  {
    number: '03',
    label: 'DELIVER',
    sticker: 'DOWNLOAD',
    stickerRotation: 'rotate-[7deg]',
    title: 'Instant Download',
    description: 'Download the pristine media file directly to your local drive with uncapped high-speed bandwidth.',
    badge: 'MAXIMUM BANDWIDTH',
    icon: Download,
    renderPattern: () => <PatternPixelBlocks />,
  },
];

export function HowItWorks() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="how-it-works"
      className="pt-10 sm:pt-14 pb-8 sm:pb-10 relative overflow-hidden bg-[#FBFBFC] text-[#0A0A0C] border-b border-black/[0.08]"
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-16 sm:space-y-20">
        
        {/* ===================================================================
            TOP HEADER AREA (Reference Match)
            Pill eyebrow + Two-column hierarchy (Bold heading / Serif italic + Narrative)
            =================================================================== */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-12">
          
          {/* Left: Large Editorial Headline */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            {/* Headline */}
            <h2 className="font-display font-[900] text-4xl sm:text-5xl lg:text-[62px] text-[#0A0A0C] tracking-[-0.04em] leading-[0.98]">
              Three Steps.<br />
              <span className="font-serif italic font-normal text-[#1A1A1E]">Pure Simplicity.</span>
            </h2>
          </motion.div>

          {/* Right: Narrative Description */}
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-md lg:pb-2"
          >
            <p className="text-sm sm:text-base text-[#6E6E78] font-sans leading-relaxed">
              Vidleo eliminates confusing conversion queues and ad walls. Paste a link, select your quality, and acquire pristine files.
            </p>
          </motion.div>

        </div>

        {/* ===================================================================
            3 CARDS GRID (Reference Match)
            Horizontal row on desktop, 2-col on tablet, 1-col on mobile
            Patterned header + Arched white content container
            =================================================================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-8 lg:gap-8 items-stretch">
          {STEPS.map((step, index) => {
            const Icon = step.icon;

            return (
              <motion.div
                key={step.number}
                initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{
                  duration: 0.6,
                  delay: index * 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="group relative rounded-[32px] sm:rounded-[36px] bg-white border border-black/[0.06] shadow-[0_16px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_24px_55px_rgba(0,0,0,0.08)] hover:-translate-y-1.5 transition-all duration-300 flex flex-col overflow-hidden cursor-default"
              >
                
                {/* 1. COLORFUL PATTERN TOP AREA */}
                <div className="relative w-full h-[140px] sm:h-[150px] overflow-hidden">
                  {/* Vector Abstract Pattern */}
                  <div className="w-full h-full transition-transform duration-500 group-hover:scale-105">
                    {step.renderPattern()}
                  </div>

                  {/* Angled Floating Sticker Badge */}
                  <div className={cn(
                    "absolute top-5 right-6 z-20 px-3.5 py-1 rounded-full bg-white/95 text-black shadow-md border border-black/[0.06] transition-transform duration-300 group-hover:scale-110",
                    step.stickerRotation
                  )}>
                    <span className="text-[10px] sm:text-[11px] font-mono font-bold tracking-wider uppercase">
                      {step.sticker}
                    </span>
                  </div>
                </div>

                {/* 2. ARCHED WHITE CONTENT BODY */}
                <div className="relative -mt-7 sm:-mt-8 rounded-t-[30px] sm:rounded-t-[34px] bg-white pt-6 px-6 sm:px-8 pb-7 flex-1 flex flex-col justify-between space-y-6 z-10">
                  
                  {/* Top Row inside Body: Icon Container + Faint Number & Pill */}
                  <div className="flex items-start justify-between">
                    {/* Black Rounded-Square Icon */}
                    <div className="w-12 h-12 rounded-2xl bg-[#0A0A0C] text-white flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-105 shrink-0">
                      <Icon className="w-5 h-5 stroke-[2.2]" />
                    </div>

                    {/* Faint Number & Category Pill */}
                    <div className="flex flex-col items-end leading-none">
                      <span className="font-display font-[850] text-3xl sm:text-4xl text-black/[0.08] tracking-tight group-hover:text-black/[0.14] transition-colors">
                        {step.number}
                      </span>
                      <span className="text-[9px] font-mono font-bold tracking-[0.16em] uppercase text-[#7A7A82] bg-black/[0.04] px-2.5 py-0.5 rounded-full mt-1.5">
                        {step.label}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div className="space-y-2.5 pt-1">
                    <h3 className="font-display font-[800] text-xl sm:text-[22px] text-[#0A0A0C] tracking-tight leading-tight">
                      {step.title}
                    </h3>
                    <p className="text-xs sm:text-[13.5px] text-[#5A5A62] font-sans leading-relaxed">
                      {step.description}
                    </p>
                  </div>

                  {/* Bottom Divider & Technical Metadata */}
                  <div className="pt-4 border-t border-black/[0.06] flex items-center justify-between text-[11px] font-mono">
                    <span className="text-[#7A7A82] font-semibold tracking-wider uppercase text-[10px] sm:text-[11px]">
                      {step.badge}
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#0A0A0C] transition-transform duration-300 group-hover:translate-x-1 shrink-0" />
                  </div>

                </div>

              </motion.div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
