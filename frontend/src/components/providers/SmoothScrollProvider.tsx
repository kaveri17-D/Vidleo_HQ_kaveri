'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Lenis from 'lenis';

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    // Do not initialize Lenis on dashboard / admin routes so sidebars, tables, and modals retain 100% native scrolling
    const isAppRoute =
      pathname?.startsWith('/dashboard') ||
      pathname?.startsWith('/admin') ||
      pathname?.startsWith('/download') ||
      pathname?.startsWith('/history');

    if (isAppRoute) return;

    // Initialize Lenis with Apple-level fluid damping for public marketing pages
    const lenis = new Lenis({
      duration: 1.0,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.0,
    });

    // Make lenis globally accessible for programmatic scroll triggers
    (window as unknown as { lenis?: Lenis }).lenis = lenis;

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    const rafId = requestAnimationFrame(raf);

    // Smooth scroll for anchor clicks (e.g. #how-it-works, #faq)
    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      if (!href) return;

      // Handle in-page hash links like "#how-it-works" or "/#how-it-works" when on homepage
      if (href.startsWith('#') || (href.startsWith('/#') && window.location.pathname === '/')) {
        const hash = href.startsWith('/#') ? href.replace('/', '') : href;
        // Guard: bare '#' is not a valid querySelector selector — skip it
        if (!hash || hash === '#') return;
        const elem = document.querySelector(hash);
        if (elem) {
          e.preventDefault();
          lenis.scrollTo(elem as HTMLElement, {
            offset: -80,
            duration: 1.0,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          });
        }
      }
    };

    document.addEventListener('click', handleAnchorClick);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('click', handleAnchorClick);
      lenis.destroy();
      delete (window as unknown as { lenis?: Lenis }).lenis;
    };
  }, [pathname]);

  return <>{children}</>;
}
