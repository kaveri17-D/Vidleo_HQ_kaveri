'use client';

import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface FloatingPathsProps {
  position?: number;
  className?: string;
}

export function FloatingPaths({ position = 1, className }: FloatingPathsProps) {
  const shouldReduceMotion = useReducedMotion();

  // Deterministically generate smooth editorial topographic paths
  const paths = useMemo(() => {
    return Array.from({ length: 22 }, (_, i) => ({
      id: i,
      d: `M-${360 - i * 6 * position} -${160 + i * 8}C-${
        360 - i * 6 * position
      } -${160 + i * 8} -${260 - i * 6 * position} ${50 + i * 7} ${
        120 - i * 6 * position
      } ${150 + i * 7}C${500 - i * 6 * position} ${250 + i * 7} ${
        820 - i * 6 * position
      } ${350 + i * 7} ${1140 - i * 6 * position} ${460 + i * 7}`,
      width: 0.75 + i * 0.035,
      opacity: 0.04 + (i % 4) * 0.012,
      duration: 22 + (i % 8) * 3,
    }));
  }, [position]);

  return (
    <div className={cn('absolute inset-0 pointer-events-none overflow-hidden select-none', className)}>
      <svg
        className="w-full h-full text-[#1A2E20]"
        viewBox="0 0 960 480"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            strokeLinecap="round"
            initial={shouldReduceMotion ? { pathLength: 1 } : { pathLength: 0.35, pathOffset: 0 }}
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    pathOffset: [0, 1],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: path.duration,
                    repeat: Infinity,
                    ease: 'linear',
                  }
            }
          />
        ))}
      </svg>
    </div>
  );
}

export function BackgroundPaths({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative w-full overflow-hidden bg-[#0c1015]', className)}>
      {/* Dual organic floating path layers for visual depth */}
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />

      {/* Soft Vignette Overlay to blend seamlessly into the surrounding page */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,#0c1015_92%)] pointer-events-none" />

      {/* Content Layer */}
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}
