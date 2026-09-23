'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownToLine, Play, Folder, ArrowRight } from 'lucide-react';

interface FeatureItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  linkText: string;
  href: string;
}

const FEATURES: FeatureItem[] = [
  {
    id: 'feature-download',
    icon: (
      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
      </svg>
    ),
    title: 'Download videos from anywhere',
    description:
      'Paste a link and save videos from your favorite platforms in the quality and format you need.',
    linkText: 'Explore video downloads',
    href: '/download',
  },
  {
    id: 'feature-formats',
    icon: (
      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    ),
    title: 'Built for every format',
    description:
      'Choose the resolution and format that works for your workflow, from everyday downloads to high-quality video.',
    linkText: 'Explore formats',
    href: '/supported-sites',
  },
  {
    id: 'feature-organize',
    icon: (
      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
      </svg>
    ),
    title: 'Keep your media organized',
    description:
      'Save your downloads in one place, find them quickly, and keep your video library easy to manage.',
    linkText: 'Explore your library',
    href: '/download',
  },
];

export function FeatureTestimonialSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative w-full pt-10 sm:pt-14 pb-20 sm:pb-28 lg:pb-32 px-4 sm:px-6 lg:px-8 bg-white text-[#0A0A0C] font-sans overflow-hidden select-none">
      <div className="max-w-[1360px] mx-auto">
        
        {/* ===================================================================
            1. THREE VERTICALLY STACKED FEATURE BLOCKS (Reference Match)
            Restrained layout with generous whitespace, small black icons,
            medium black titles, gray descriptions, and underlined link.
            =================================================================== */}
        <div className="max-w-[680px] space-y-12 sm:space-y-16">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.id}
              initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{
                duration: 0.6,
                delay: index * 0.1,
                ease: 'easeOut',
              }}
              className="space-y-2.5"
            >
              {/* Feature Icon */}
              <div className="text-[#0A0A0C] pb-0.5">
                {feature.icon}
              </div>

              {/* Feature Title */}
              <h3 className="font-sans font-medium text-[17px] sm:text-[18px] text-[#0A0A0C] tracking-tight leading-snug">
                {feature.title}
              </h3>

              {/* Feature Description */}
              <p className="font-sans text-[15px] sm:text-[16px] text-[#6B7280] leading-relaxed">
                {feature.description}
              </p>

              {/* Feature Link */}
              <div className="pt-1">
                <a
                  href={feature.href}
                  className="inline-flex items-center gap-1.5 text-[14px] sm:text-[15px] font-normal text-[#0A0A0C] underline underline-offset-4 hover:text-[#5B4BFF] transition-colors group"
                >
                  <span>{feature.linkText}</span>
                  <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </a>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ===================================================================
            2. EDITORIAL TESTIMONIAL BLOCK (Reference Match)
            Subtle vertical border line on left, large quotation,
            author avatar/role on bottom left, and 'Explore Vidleo →' on bottom right.
            =================================================================== */}
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className="mt-20 sm:mt-28 lg:mt-36 border-l-2 border-[#E5E7EB] pl-5 sm:pl-7 lg:pl-8 py-2"
        >
          {/* Large Quote */}
          <blockquote className="font-display font-[850] sm:font-[900] text-2xl sm:text-4xl lg:text-[42px] text-[#0A0A0C] tracking-[-0.03em] leading-[1.14] max-w-4xl">
            “Vidleo makes it simple to save the videos I need and keep everything organized in one place.”
          </blockquote>

          {/* Testimonial Bottom Row: Avatar / Name / Role on Left, CTA on Right */}
          <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            
            {/* Author Profile */}
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden bg-[#ECECED] border border-black/10 shrink-0">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop"
                  alt="Alex Morgan"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="space-y-0.5">
                <h4 className="font-sans font-semibold text-sm sm:text-[15px] text-[#0A0A0C] leading-none">
                  Alex Morgan
                </h4>
                <p className="font-sans text-xs sm:text-[13px] text-[#6B7280] leading-none">
                  Creator & Video Producer
                </p>
              </div>
            </div>

            {/* Testimonial CTA (Far Right) */}
            <div>
              <a
                href="/download"
                className="inline-flex items-center gap-1.5 text-sm sm:text-[15px] font-medium text-[#0A0A0C] underline underline-offset-4 hover:text-[#5B4BFF] transition-colors group"
              >
                <span>Explore Vidleo</span>
                <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </a>
            </div>

          </div>
        </motion.div>

      </div>
    </section>
  );
}
