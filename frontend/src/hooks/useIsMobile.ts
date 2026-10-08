import { useState, useEffect } from 'react';

/**
 * Hook to detect whether the user is on a mobile device (iOS/Android/touch).
 * SSR-safe, hydrates cleanly on client.
 */
export function useIsMobile(): { isMobile: boolean; isAndroid: boolean; isIOS: boolean } {
  const [deviceState, setDeviceState] = useState({
    isMobile: false,
    isAndroid: false,
    isIOS: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkMobile = () => {
      const ua = navigator.userAgent || '';
      const isAndroid = /Android/i.test(ua);
      const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
      
      // Also check viewport heuristic
      const isTouchNarrowScreen = window.innerWidth < 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

      // Support explicit testing override in query parameters
      const urlParams = new URLSearchParams(window.location.search);
      const forcedMobile = urlParams.get('mobile') === '1' || urlParams.get('device') === 'mobile';

      const isMobile = forcedMobile || isMobileUA || isTouchNarrowScreen;

      setDeviceState({
        isMobile,
        isAndroid,
        isIOS,
      });
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return deviceState;
}
