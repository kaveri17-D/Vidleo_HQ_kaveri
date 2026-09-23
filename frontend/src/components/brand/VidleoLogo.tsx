'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface VidleoLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  showSublabel?: boolean;
  isLight?: boolean;
  isDarkSurround?: boolean;
  variant?: 'default' | 'icon' | 'dark';
}

/**
 * CINEMA FRAME VIDLEO ICON MARK (Image 2 Branding)
 * 1. Outer squircle: light silver/off-white cinema frame
 * 2. Inner squircle: solid dark near-black container
 * 3. Center pill: vivid electric blue vertical rounded capsule
 */
export function VidleoSymbol({
  className,
  size = 28,
  isDarkSurround = false,
}: {
  className?: string;
  size?: number;
  isDarkSurround?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0 transition-transform duration-200 group-hover:scale-105 select-none', className)}
      aria-label="Vidleo Logo Mark"
    >
      {/* Outer Cinema Frame Squircle */}
      <rect
        x="4"
        y="4"
        width="92"
        height="92"
        rx="28"
        fill={isDarkSurround ? '#1E2026' : '#EFF1F5'}
        stroke={isDarkSurround ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'}
        strokeWidth="2.5"
      />
      
      {/* Inner Dark Squircle Container */}
      <rect
        x="22"
        y="22"
        width="56"
        height="56"
        rx="17"
        fill="#0E0E12"
      />
      
      {/* Center Vivid Electric Blue Vertical Capsule */}
      <rect
        x="45.5"
        y="33"
        width="9"
        height="34"
        rx="4.5"
        fill="#256BF5"
      />
    </svg>
  );
}

/**
 * CINEMA FRAME VIDLEO FULL LOGO (Icon + Lowercase Wordmark + Blue Underline under "vid")
 */
export function VidleoLogo({
  className,
  size = 'md',
  showSublabel = false,
  isLight = true,
  isDarkSurround,
}: VidleoLogoProps) {
  const symbolSize =
    typeof size === 'number'
      ? size
      : size === 'xs'
      ? 22
      : size === 'sm'
      ? 26
      : size === 'lg'
      ? 36
      : size === 'xl'
      ? 44
      : 30;

  const darkSurround = isDarkSurround ?? !isLight;

  return (
    <div className={cn('inline-flex items-center gap-2.5 sm:gap-3 group select-none cursor-pointer', className)}>
      {/* Left Icon: Cinema Frame with Blue Vertical Bar */}
      <VidleoSymbol size={symbolSize} isDarkSurround={darkSurround} />
      
      {/* Right Wordmark: "vidleo" with Blue Underline ONLY under "vid" */}
      <div className="flex flex-col justify-center leading-none">
        <div className="relative inline-flex items-start">
          <span
            className={cn(
              'font-display font-[800] tracking-[-0.035em] lowercase leading-none block transition-colors',
              typeof size === 'number'
                ? 'text-[17px]'
                : size === 'xs'
                ? 'text-[13px]'
                : size === 'sm'
                ? 'text-[15px]'
                : size === 'lg'
                ? 'text-[21px]'
                : size === 'xl'
                ? 'text-[26px]'
                : 'text-[18px]',
              isLight
                ? 'text-[#0E0E10] group-hover:text-black'
                : 'text-[#FDFCF7] group-hover:text-white'
            )}
          >
            {/* 'vid' with matching blue horizontal bar directly underneath */}
            <span className="relative inline-block">
              vid
              <span
                className={cn(
                  'absolute left-0 right-0 bg-[#256BF5] rounded-full pointer-events-none',
                  typeof size === 'number' || size === 'md'
                    ? 'h-[2.5px] -bottom-[4px]'
                    : size === 'xs'
                    ? 'h-[1.75px] -bottom-[3px]'
                    : size === 'sm'
                    ? 'h-[2px] -bottom-[3.5px]'
                    : size === 'lg'
                    ? 'h-[3px] -bottom-[5px]'
                    : 'h-[3.5px] -bottom-[6px]'
                )}
              />
            </span>
            {/* 'leo' without underline */}
            <span>leo</span>
          </span>
        </div>

        {showSublabel && (
          <span
            className={cn(
              'font-mono font-bold tracking-[0.18em] uppercase transition-colors leading-none pt-2 text-[7.5px]',
              isLight ? 'text-[#7A7A7D]' : 'text-white/50'
            )}
          >
            A SYNAPVO PRODUCT
          </span>
        )}
      </div>
    </div>
  );
}
