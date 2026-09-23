'use client';

import React from 'react';
import { PlatformCard, PlatformItem } from './PlatformCard';
import { cn } from '@/lib/utils';

interface PlatformMarqueeProps {
  items: PlatformItem[];
  direction?: 'left' | 'right';
  speedClass?: string;
  className?: string;
}

export function PlatformMarquee({
  items,
  direction = 'left',
  speedClass = 'animate-marquee-left-38s',
  className,
}: PlatformMarqueeProps) {
  // Seamless loop by duplicating items
  const duplicatedItems = [...items, ...items];

  return (
    <div className={cn('relative w-full overflow-hidden flex select-none py-2', className)}>
      <div
        className={cn(
          'flex gap-4 sm:gap-6 shrink-0',
          speedClass
        )}
      >
        {duplicatedItems.map((platform, idx) => (
          <PlatformCard key={`${platform.id}-${idx}`} platform={platform} />
        ))}
      </div>
    </div>
  );
}
