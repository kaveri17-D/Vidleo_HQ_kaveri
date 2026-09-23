'use client';

import React, { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { MacbookScreenContent } from './MacbookScreenContent';
import { cn } from '@/lib/utils';

interface MacbookScrollProps {
  className?: string;
  badge?: React.ReactNode;
}

export function MacbookScroll({ className, badge }: MacbookScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  // Scroll progress tracker tied to the 120vh-140vh scroll track
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  // Hinge Rotation: Starts tilted/partially closed (-55deg) and smoothly opens flat (0deg)
  const rotateX = useTransform(
    scrollYProgress,
    [0.1, 0.55],
    shouldReduceMotion ? [0, 0] : [-52, 0]
  );

  // Scale: Laptop emerges toward the user
  const scale = useTransform(
    scrollYProgress,
    [0.1, 0.6],
    shouldReduceMotion ? [1, 1] : [0.88, 1]
  );

  // Vertical position translation
  const translateZ = useTransform(
    scrollYProgress,
    [0.1, 0.6],
    shouldReduceMotion ? [0, 0] : [-80, 0]
  );

  // Screen glare reflection opacity
  const glareOpacity = useTransform(
    scrollYProgress,
    [0.1, 0.45, 0.7],
    [0.4, 0.15, 0]
  );

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full flex flex-col items-center justify-start py-10 min-h-[900px] sm:min-h-[1150px]', className)}
    >
      {/* Sticky presentation viewport container */}
      <div className="sticky top-20 sm:top-24 w-full flex flex-col items-center justify-center perspective-[1200px] overflow-visible">
        {/* Optional Floating Top Badge */}
        {badge && (
          <div className="mb-6 z-30 transition-opacity duration-300">
            {badge}
          </div>
        )}

        {/* 3D Laptop Container */}
        <motion.div
          style={{
            scale,
            transformStyle: 'preserve-3d',
          }}
          className="relative w-full max-w-[340px] sm:max-w-[620px] md:max-w-[820px] lg:max-w-[980px] xl:max-w-[1080px] aspect-[16/10] flex flex-col items-center select-none"
        >
          {/* ======================================================== */}
          {/* 1. LID (SCREEN DISPLAY) - Rotates around bottom hinge    */}
          {/* ======================================================== */}
          <motion.div
            style={{
              rotateX,
              translateZ,
              transformOrigin: 'bottom center',
              transformStyle: 'preserve-3d',
            }}
            className="relative z-20 w-full aspect-[16/10] bg-[#16161A] rounded-t-2xl sm:rounded-t-3xl p-2 sm:p-3 pb-1 border border-white/[0.16] shadow-2xl shadow-black/90 flex flex-col overflow-hidden"
          >
            {/* Top Bezel Webcam Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 sm:w-20 h-2.5 sm:h-3.5 bg-black rounded-b-md z-30 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1A1A24] border border-white/20 flex items-center justify-center">
                <div className="w-0.5 h-0.5 rounded-full bg-[#38BDF8]/60" />
              </div>
            </div>

            {/* Inner Display Bezel */}
            <div className="relative w-full h-full rounded-t-xl sm:rounded-t-2xl overflow-hidden bg-black border border-white/[0.08] flex flex-col">
              {/* Vidleo Product UI inside screen */}
              <MacbookScreenContent />

              {/* Dynamic Screen Glare Overlay */}
              <motion.div
                style={{ opacity: glareOpacity }}
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.08] to-white/[0.15] mix-blend-overlay"
              />
            </div>

            {/* Bottom Screen Hinge Cover Bar */}
            <div className="w-full h-2 sm:h-3 bg-[#0D0D10] border-t border-white/[0.08] flex items-center justify-center">
              <span className="text-[7px] sm:text-[8px] font-mono tracking-[0.2em] text-muted-dark uppercase">
                VIDLEO ENGINE
              </span>
            </div>
          </motion.div>

          {/* ======================================================== */}
          {/* 2. BASE (KEYBOARD & TRACKPAD)                            */}
          {/* ======================================================== */}
          <div className="relative z-10 w-[104%] -mt-1 sm:-mt-2 h-6 sm:h-10 bg-gradient-to-b from-[#1C1C22] to-[#121215] rounded-b-xl sm:rounded-b-2xl border-x border-b border-white/[0.14] shadow-2xl shadow-black flex items-center justify-center">
            {/* Front thumb indent */}
            <div className="w-16 sm:w-28 h-1 sm:h-1.5 bg-[#0B0B0C] rounded-full border-t border-white/10" />

            {/* Left & right side ports hint */}
            <div className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-2 h-1 bg-black/80 rounded-sm" />
            <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-2 h-1 bg-black/80 rounded-sm" />
          </div>

          {/* Realistic Bottom Shadow Glow */}
          <div className="absolute -bottom-8 w-4/5 h-12 bg-black/80 blur-2xl -z-10 rounded-full pointer-events-none" />
          <div className="absolute -bottom-6 w-3/5 h-8 bg-accent/5 blur-3xl -z-10 rounded-full pointer-events-none" />
        </motion.div>
      </div>
    </div>
  );
}
