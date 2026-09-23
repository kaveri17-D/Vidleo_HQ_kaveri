'use client';

import React, { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Sparkles } from 'lucide-react';

export function HeroVisual() {
  const visualRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: visualRef,
    offset: ['start end', 'end start'],
  });

  const centerScale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    shouldReduceMotion ? [1, 1, 1] : [1, 1.02, 0.97]
  );
  const centerY = useTransform(
    scrollYProgress,
    [0, 1],
    shouldReduceMotion ? ['0px', '0px'] : ['0px', '-20px']
  );

  return (
    <div
      ref={visualRef}
      className="relative w-full max-w-2xl mx-auto pt-4 sm:pt-6 pb-2 select-none"
    >
      {/* Centered, Prominent Feature Pill: Direct High-Bitrate Processing */}
      <motion.div
        style={{ scale: centerScale, y: centerY }}
        className="relative z-20 flex items-center justify-center transform-gpu will-change-transform"
      >
        <div className="group px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-white/95 backdrop-blur-2xl border border-black/[0.08] shadow-[0_16px_45px_rgba(0,0,0,0.08)] hover:shadow-[0_22px_55px_rgba(0,0,0,0.12)] hover:border-black/15 transition-all duration-300 flex items-center gap-3 sm:gap-3.5">
          <div className="w-8 h-8 rounded-full bg-[#0E0E10] text-[#FDFCF7] flex items-center justify-center text-xs font-bold shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-200">
            <Sparkles className="w-3.5 h-3.5 text-[#B8E600]" />
          </div>
          <div className="text-left">
            <span className="text-xs sm:text-[13px] font-semibold text-[#0E0E10] block tracking-tight leading-tight">
              Direct High-Bitrate Processing
            </span>
            <span className="text-[10px] sm:text-[11px] text-[#5A5A5C] font-sans block pt-0.5">
              Lossless extraction without watermarks
            </span>
          </div>
          <span className="text-[9.5px] sm:text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full bg-[#B8E600]/25 text-[#171717] border border-[#B8E600]/40 ml-1 sm:ml-2 shrink-0">
            Ready
          </span>
        </div>
      </motion.div>
    </div>
  );
}
