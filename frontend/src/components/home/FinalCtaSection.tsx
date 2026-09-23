'use client';

import React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';

// Words for staggered word-by-word animation
const LINE_1_WORDS = ['Ready', 'to', 'extract', 'in'];
const LINE_2_WORDS = [
  { text: 'pristine', isSerif: false },
  { text: '4K', isSerif: true },
  { text: 'quality?', isSerif: true },
];

export function FinalCtaSection() {
  const shouldReduceMotion = useReducedMotion();

  // Animation variants
  const wordVariants = {
    hidden: { 
      opacity: 0, 
      y: shouldReduceMotion ? 0 : 22,
      filter: shouldReduceMotion ? 'none' : 'blur(5px)',
    },
    visible: (customDelay: number) => ({
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: {
        duration: 0.55,
        delay: shouldReduceMotion ? 0 : customDelay,
        ease: [0.22, 1, 0.36, 1],
      },
    }),
  };

  return (
    <section className="pt-8 sm:pt-12 pb-20 sm:pb-28 relative bg-[#F6F5F2] text-[#0A0A0C] overflow-hidden select-none font-sans">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* ===================================================================
            LAYERED COMPOSITION
            Behind: 2 Abstract rounded pastel rectangles (Soft Coral & Dusty Pink)
            Foreground: Large Black Rounded Editorial CTA Card
            =================================================================== */}
        <div className="relative w-full flex items-center justify-center">
          
          {/* BACKGROUND LAYER 1: Soft Warm Coral / Orange (Bottom Left Offset) */}
          <div 
            className="absolute -bottom-4 sm:-bottom-7 -left-3 sm:-left-8 w-[92%] sm:w-[94%] h-[90%] sm:h-[94%] rounded-[36px] sm:rounded-[52px] bg-[#E87F52] shadow-[0_20px_50px_rgba(232,127,82,0.18)] pointer-events-none"
            style={{
              transform: 'rotate(-5.5deg)',
            }}
          />

          {/* BACKGROUND LAYER 2: Soft Dusty Pink / Lavender (Top Right Offset) */}
          <div 
            className="absolute -top-4 sm:-top-7 -right-3 sm:-right-8 w-[90%] sm:w-[93%] h-[92%] sm:h-[95%] rounded-[36px] sm:rounded-[52px] bg-[#E1A2C3] shadow-[0_20px_50px_rgba(225,162,195,0.18)] pointer-events-none"
            style={{
              transform: 'rotate(6.5deg)',
            }}
          />

          {/* =================================================================
              MAIN BLACK CTA CARD
              ================================================================= */}
          <div className="relative z-20 w-full rounded-[30px] sm:rounded-[42px] bg-[#0E0F12] shadow-[0_35px_90px_rgba(0,0,0,0.4)] p-8 sm:p-14 lg:p-20 text-center text-white overflow-hidden">
            
            <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8 flex flex-col items-center">
              
              {/* 1. HEADLINE WITH SEQUENTIAL WORD-BY-WORD REVEAL */}
              <h2 className="font-display font-[850] text-[36px] sm:text-[54px] lg:text-[70px] text-white tracking-[-0.04em] leading-[1.04] text-balance flex flex-col items-center justify-center">
                
                {/* Line 1: "Ready to extract in" */}
                <span className="inline-flex flex-wrap items-center justify-center gap-x-[0.3em]">
                  {LINE_1_WORDS.map((word, idx) => (
                    <motion.span
                      key={word}
                      custom={idx * 0.09}
                      variants={wordVariants}
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true }}
                      className="inline-block"
                    >
                      {word}
                    </motion.span>
                  ))}
                </span>

                {/* Line 2: "pristine 4K quality?" */}
                <span className="inline-flex flex-wrap items-center justify-center gap-x-[0.3em]">
                  {LINE_2_WORDS.map((item, idx) => {
                    const wordDelay = (LINE_1_WORDS.length + idx) * 0.09 + 0.05;
                    return (
                      <motion.span
                        key={item.text}
                        custom={wordDelay}
                        variants={wordVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className={
                          item.isSerif
                            ? "font-serif italic font-normal text-white inline-block"
                            : "inline-block"
                        }
                      >
                        {item.text}
                      </motion.span>
                    );
                  })}
                </span>

              </h2>

              {/* 3. CONCISE NARRATIVE DESCRIPTION (Reveals after Headline) */}
              <motion.p
                initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 14, filter: 'blur(4px)' }}
                whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.65,
                  delay: shouldReduceMotion ? 0 : 0.75,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="text-xs sm:text-sm md:text-base text-white/60 font-sans font-normal leading-relaxed max-w-[500px] text-balance"
              >
                No registration required. Enter a video link and acquire uncompressed streams in seconds.
              </motion.p>

              {/* 4. DUAL CTA BUTTONS (NO ARROWS in text) */}
              <div className="pt-2 sm:pt-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full sm:w-auto">
                
                {/* Primary Button */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.55,
                    delay: shouldReduceMotion ? 0 : 0.95,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="w-full sm:w-auto"
                >
                  <Link
                    href="/download"
                    className="w-full sm:w-auto inline-flex items-center justify-center bg-[#FDFDFD] hover:bg-white text-black px-8 sm:px-9 py-3.5 sm:py-4 rounded-full font-sans font-bold text-xs tracking-wider uppercase transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-black/40 cursor-pointer"
                  >
                    LAUNCH DOWNLOADER APP
                  </Link>
                </motion.div>

                {/* Secondary Button */}
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.55,
                    delay: shouldReduceMotion ? 0 : 1.05,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="w-full sm:w-auto"
                >
                  <Link
                    href="/supported-sites"
                    className="w-full sm:w-auto inline-flex items-center justify-center bg-[#18181C] hover:bg-[#222226] border border-white/15 hover:border-white/30 text-white/85 hover:text-white px-8 sm:px-9 py-3.5 sm:py-4 rounded-full font-sans font-semibold text-xs tracking-wider uppercase transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
                  >
                    VIEW SUPPORTED SITES
                  </Link>
                </motion.div>

              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
