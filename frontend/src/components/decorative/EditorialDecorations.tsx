'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

// =========================================================================
// 1. YELLOW ZIG-ZAG / LIGHTNING DOODLE
// =========================================================================
export function YellowZigZag({
  className,
  rotation = 12,
  delay = 0,
  duration = 7,
}: {
  className?: string;
  rotation?: number;
  delay?: number;
  duration?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ rotate: rotation }}
      animate={
        shouldReduceMotion
          ? { rotate: rotation }
          : {
              y: [-4, 5, -4],
              x: [-2, 3, -2],
              rotate: [rotation - 3, rotation + 3, rotation - 3],
            }
      }
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn(
        'pointer-events-none select-none drop-shadow-[0_2px_8px_rgba(234,179,8,0.25)]',
        className
      )}
    >
      <svg
        width="48"
        height="28"
        viewBox="0 0 64 36"
        fill="none"
        stroke="#EAB308"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 18L18 6L32 30L46 8L60 22" />
      </svg>
    </motion.div>
  );
}

// =========================================================================
// 2. BLUE HAND-DRAWN BIRD FORMATION
// =========================================================================
export function BlueBirdFlock({
  className,
  count = 4,
  delay = 0,
}: {
  className?: string;
  count?: number;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={
        shouldReduceMotion
          ? {}
          : {
              y: [-5, 6, -5],
              x: [-3, 4, -3],
            }
      }
      transition={{
        duration: 9,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn('pointer-events-none select-none flex items-center gap-2', className)}
    >
      <svg
        width="64"
        height="40"
        viewBox="0 0 84 52"
        fill="none"
        stroke="#38BDF8"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-85 drop-shadow-[0_2px_6px_rgba(56,189,248,0.3)]"
      >
        {/* Bird 1 */}
        <path d="M4 14C8 6 14 10 18 16C22 10 28 6 32 14" />
        {/* Bird 2 */}
        <path d="M38 8C41 2 46 5 49 10C52 5 57 2 60 8" />
        {/* Bird 3 */}
        <path d="M52 28C55 22 59 25 62 29C65 25 69 22 72 28" />
        {/* Bird 4 */}
        <path d="M22 36C25 31 29 33 32 37C35 33 39 31 42 36" />
      </svg>
    </motion.div>
  );
}

// =========================================================================
// 3. EDITORIAL STICKER / FLOATING FORMAT TAG
// =========================================================================
export function FloatingEditorialTag({
  text,
  iconType = 'sparkle',
  color = 'lime',
  tilt = -6,
  delay = 0,
  className,
}: {
  text: string;
  iconType?: 'sparkle' | 'video' | 'audio' | 'check' | 'source';
  color?: 'lime' | 'pink' | 'blue' | 'purple' | 'amber';
  tilt?: number;
  delay?: number;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();

  // Color mappings for badge accent
  const colorMap = {
    lime: {
      bg: 'bg-[#B8E600]',
      shadow: 'shadow-[0_4px_16px_rgba(184,230,0,0.3)]',
      border: 'border-black/10',
      text: 'text-[#0E0E10]',
      pin: 'bg-[#0E0E10] text-[#B8E600]',
    },
    pink: {
      bg: 'bg-[#F472B6]',
      shadow: 'shadow-[0_4px_16px_rgba(244,114,182,0.3)]',
      border: 'border-pink-300',
      text: 'text-white',
      pin: 'bg-white text-[#EC4899]',
    },
    blue: {
      bg: 'bg-[#38BDF8]',
      shadow: 'shadow-[0_4px_16px_rgba(56,189,248,0.3)]',
      border: 'border-sky-300',
      text: 'text-white',
      pin: 'bg-white text-[#0284C7]',
    },
    purple: {
      bg: 'bg-[#C084FC]',
      shadow: 'shadow-[0_4px_16px_rgba(192,132,252,0.3)]',
      border: 'border-purple-300',
      text: 'text-white',
      pin: 'bg-white text-[#9333EA]',
    },
    amber: {
      bg: 'bg-[#FBBF24]',
      shadow: 'shadow-[0_4px_16px_rgba(251,191,36,0.3)]',
      border: 'border-amber-300',
      text: 'text-[#0E0E10]',
      pin: 'bg-[#0E0E10] text-[#FBBF24]',
    },
  };

  const currentTheme = colorMap[color];

  return (
    <motion.div
      initial={{ rotate: tilt }}
      animate={
        shouldReduceMotion
          ? { rotate: tilt }
          : {
              y: [-4, 5, -4],
              rotate: [tilt - 2, tilt + 2, tilt - 2],
            }
      }
      transition={{
        duration: 6.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn(
        'pointer-events-none select-none relative inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-sans font-extrabold text-[10.5px] uppercase tracking-wider',
        currentTheme.bg,
        currentTheme.text,
        currentTheme.shadow,
        currentTheme.border,
        'border',
        className
      )}
    >
      {/* Small Pin / Icon Circle */}
      <span
        className={cn(
          'w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-bold shadow-sm shrink-0',
          currentTheme.pin
        )}
      >
        {iconType === 'sparkle' && '✦'}
        {iconType === 'video' && '▶'}
        {iconType === 'audio' && '♫'}
        {iconType === 'check' && '✓'}
        {iconType === 'source' && '❖'}
      </span>

      <span>{text}</span>
    </motion.div>
  );
}

// =========================================================================
// 4. COLORFUL ABSTRACT DOODLES (Squiggle, Loops, Stars)
// =========================================================================
export function PinkSquiggle({
  className,
  rotation = -8,
  delay = 0,
}: {
  className?: string;
  rotation?: number;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ rotate: rotation }}
      animate={
        shouldReduceMotion
          ? { rotate: rotation }
          : {
              y: [-3, 4, -3],
              rotate: [rotation - 2, rotation + 2, rotation - 2],
            }
      }
      transition={{
        duration: 7.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn(
        'pointer-events-none select-none drop-shadow-[0_2px_6px_rgba(244,114,182,0.3)]',
        className
      )}
    >
      <svg
        width="44"
        height="24"
        viewBox="0 0 54 30"
        fill="none"
        stroke="#F472B6"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 16C10 6 18 6 24 16C30 26 38 26 44 16C47 11 50 12 52 14" />
      </svg>
    </motion.div>
  );
}

export function YellowLoopDoodle({
  className,
  rotation = 15,
  delay = 0,
}: {
  className?: string;
  rotation?: number;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ rotate: rotation }}
      animate={
        shouldReduceMotion
          ? { rotate: rotation }
          : {
              y: [4, -5, 4],
              rotate: [rotation + 3, rotation - 3, rotation + 3],
            }
      }
      transition={{
        duration: 8,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn(
        'pointer-events-none select-none drop-shadow-[0_2px_8px_rgba(234,179,8,0.25)]',
        className
      )}
    >
      <svg
        width="38"
        height="38"
        viewBox="0 0 48 48"
        fill="none"
        stroke="#FACC15"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 36C6 28 6 16 14 10C22 4 30 10 26 22C22 34 34 40 42 32C46 28 46 20 40 16" />
      </svg>
    </motion.div>
  );
}

export function LimeBowlDoodle({
  className,
  rotation = -12,
  delay = 0,
}: {
  className?: string;
  rotation?: number;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ rotate: rotation }}
      animate={
        shouldReduceMotion
          ? { rotate: rotation }
          : {
              y: [-4, 4, -4],
              rotate: [rotation - 2, rotation + 2, rotation - 2],
            }
      }
      transition={{
        duration: 8.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn(
        'pointer-events-none select-none drop-shadow-[0_2px_8px_rgba(184,230,0,0.35)]',
        className
      )}
    >
      <svg
        width="46"
        height="46"
        viewBox="0 0 56 56"
        fill="none"
        stroke="#B8E600"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 22C10 34 26 34 26 22H10Z" />
        <path d="M24 38C24 50 40 50 40 38H24Z" />
      </svg>
    </motion.div>
  );
}

export function HandDrawnSparkle({
  className,
  color = '#EAB308',
  size = 20,
  delay = 0,
}: {
  className?: string;
  color?: string;
  size?: number;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={
        shouldReduceMotion
          ? {}
          : {
              scale: [0.85, 1.15, 0.85],
              rotate: [0, 45, 0],
            }
      }
      transition={{
        duration: 5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn('pointer-events-none select-none', className)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        className="opacity-90"
      >
        <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
      </svg>
    </motion.div>
  );
}

export function HandDrawnArrow({
  className,
  rotation = 0,
  color = '#38BDF8',
  delay = 0,
}: {
  className?: string;
  rotation?: number;
  color?: string;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ rotate: rotation }}
      animate={
        shouldReduceMotion
          ? { rotate: rotation }
          : {
              y: [-2, 3, -2],
              x: [-1, 2, -1],
            }
      }
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      className={cn('pointer-events-none select-none', className)}
    >
      <svg
        width="38"
        height="30"
        viewBox="0 0 48 36"
        fill="none"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 28C14 26 28 18 42 8M42 8L32 6M42 8L40 18" />
      </svg>
    </motion.div>
  );
}
