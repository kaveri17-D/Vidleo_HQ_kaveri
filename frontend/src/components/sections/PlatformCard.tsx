'use client';

import React from 'react';
import { ArrowRight, Plus, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlatformItem {
  id: string;
  name: string;
  description: string;
  ctaText?: string;
  ctaHref?: string;
  isSpecial?: boolean;
  accentGlow: string; // CSS rgba glow
  borderColor: string; // CSS border
  bgColor: string;
  iconBg: string;
  iconSvg: React.ReactNode;
  imageUrl: string;
}

export function PlatformCard({ platform }: { platform: PlatformItem }) {
  const isSpecial = platform.isSpecial;

  return (
    <div
      style={{
        boxShadow: `0 10px 30px -10px ${platform.accentGlow}`,
        borderColor: platform.borderColor,
      }}
      className={cn(
        'group relative w-[260px] sm:w-[290px] md:w-[310px] h-[340px] sm:h-[360px] rounded-[24px] sm:rounded-[28px] p-5 sm:p-6 flex flex-col justify-between shrink-0 select-none overflow-hidden transition-all duration-300 transform hover:scale-[1.03] hover:z-20 border backdrop-blur-md',
        platform.bgColor
      )}
    >
      {/* Top Ambient Glow Gradient Layer */}
      <div
        style={{
          background: `radial-gradient(circle at 80% 20%, ${platform.accentGlow} 0%, transparent 70%)`,
        }}
        className="absolute inset-0 pointer-events-none opacity-60 group-hover:opacity-100 transition-opacity duration-500"
      />

      {/* Top Section: Platform Icon & Organic Masked Image */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        {/* Platform Icon Badge */}
        <div
          className={cn(
            'w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shrink-0 border border-white/10 shadow-lg',
            platform.iconBg
          )}
        >
          {platform.iconSvg}
        </div>

        {/* Organic Curved Masked Cinematic Image */}
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 overflow-hidden rounded-[20px] sm:rounded-[22px] border border-white/10 bg-black/60 shadow-inner group-hover:border-white/20 transition-colors">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={platform.imageUrl}
            alt={platform.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
            loading="lazy"
          />
          {/* Subtle gradient shadow inside image */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        </div>
      </div>

      {/* Middle: Title & Description */}
      <div className="relative z-10 space-y-1.5 pt-2">
        <h3 className="font-display font-[750] text-lg sm:text-xl text-foreground group-hover:text-white transition-colors tracking-tight">
          {platform.name}
        </h3>
        <p className="text-xs text-muted-light font-sans leading-relaxed line-clamp-2">
          {platform.description}
        </p>
      </div>

      {/* Bottom CTA Button */}
      <div className="relative z-10 pt-2">
        <a
          href={platform.ctaHref || '/download'}
          className={cn(
            'inline-flex items-center justify-between gap-2 px-4 py-2 rounded-full text-xs font-semibold font-sans tracking-wide transition-all duration-200 border',
            isSpecial
              ? 'bg-accent text-background border-accent font-bold hover:bg-white shadow-md'
              : 'bg-white/[0.04] text-foreground border-white/15 hover:bg-white/10 hover:border-white/30'
          )}
        >
          <span>{platform.ctaText || 'Try Now'}</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
        </a>
      </div>
    </div>
  );
}
