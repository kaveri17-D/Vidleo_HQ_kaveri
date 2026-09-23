'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Zap, ShieldCheck, Gauge, ArrowRight } from 'lucide-react';

const FEATURES = [
  {
    tag: 'PERFORMANCE',
    headline: 'Fast Throughput',
    statement: 'From URL to file in moments.',
    detail:
      'Engineered with direct manifest stream chunking and low-latency DNS resolution. Download high-bitrate media files without throttling, queuing, or artificial delays.',
    metric: '< 2.4s',
    metricLabel: 'Average Manifest Analysis Time',
    icon: Zap,
    accent: '#0A0A0C',
  },
  {
    tag: 'FIDELITY',
    headline: 'Native Quality',
    statement: 'Choose the format that fits your needs.',
    detail:
      'Preserve raw 4K UHD, 1440p, 1080p 60fps video feeds and studio-grade 320kbps MP3 audio without re-encoding compression or lossy artifacts.',
    metric: '4K HDR',
    metricLabel: 'Uncompressed Visual Stream',
    icon: Gauge,
    accent: '#0A0A0C',
  },
  {
    tag: 'EXPERIENCE',
    headline: 'Zero Friction',
    statement: 'No unnecessary workflow. Just paste and download.',
    detail:
      'No registration walls, no browser extension requirements, no deceptive download buttons. A focused, clean utility designed for creative professionals.',
    metric: '0 Bloat',
    metricLabel: 'Zero Ad Walls or Trackers',
    icon: ShieldCheck,
    accent: '#0A0A0C',
  },
];

export function FeatureBlocks() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="pt-8 sm:pt-12 pb-8 sm:pb-12 relative overflow-hidden bg-[#F6F6F8] dot-grid-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Heading */}
        <div className="max-w-2xl mb-10 sm:mb-12 space-y-3">
          <h2 className="font-display font-[850] text-3xl sm:text-5xl lg:text-6xl text-[#0A0A0C] tracking-[-0.035em] leading-[0.98]">
            Engineered For<br />
            <span className="font-serif italic font-normal text-[#5A5A62]">Zero Friction.</span>
          </h2>
        </div>

        {/* 3 Modular Feature Blocks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {FEATURES.map((feat, index) => {
            const Icon = feat.icon;

            return (
              <motion.div
                key={feat.headline}
                initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{
                  duration: 0.55,
                  delay: index * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="modular-card-light p-8 rounded-[28px] hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-between space-y-8 group"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-[#7A7A82] px-3 py-1 rounded-full bg-[#F4F4F6] border border-black/[0.04]">
                      {feat.tag}
                    </span>
                    <div className="w-10 h-10 rounded-2xl bg-[#0A0A0C] text-white flex items-center justify-center shadow-xs">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  <h3 className="font-display font-[800] text-2xl sm:text-3xl text-[#0A0A0C] tracking-tight">
                    {feat.headline}
                  </h3>

                  <p className="text-sm font-semibold text-[#0A0A0C] font-sans mt-2">
                    "{feat.statement}"
                  </p>

                  <p className="text-xs sm:text-[13.5px] text-[#5A5A62] leading-relaxed font-sans mt-3">
                    {feat.detail}
                  </p>
                </div>

                {/* Bottom Metric Card */}
                <div className="p-4 rounded-2xl bg-[#F8F8FA] border border-black/[0.06] flex items-center justify-between">
                  <div>
                    <span className="font-display font-bold text-xl text-[#0A0A0C] block tracking-tight">
                      {feat.metric}
                    </span>
                    <span className="text-[10px] font-mono text-[#7A7A82] uppercase font-semibold">
                      {feat.metricLabel}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#7A7A82] group-hover:text-black group-hover:translate-x-1 transition-all" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
