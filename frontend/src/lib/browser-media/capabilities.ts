/**
 * Capability and device constraint detector for browser-side media processing
 */
import { BrowserMediaCapabilities } from './types';

export function detectBrowserCapabilities(): BrowserMediaCapabilities {
  const isBrowser = typeof window !== 'undefined';
  const reasons: string[] = [];

  if (!isBrowser) {
    return {
      webAssemblySupported: false,
      webWorkersSupported: false,
      sharedArrayBufferSupported: false,
      crossOriginIsolated: false,
      isMobileDevice: false,
      estimatedMemoryMB: 0,
      maxSafeInputBytes: 0,
      maxSafeDurationSeconds: 0,
      browserProcessingRecommended: false,
      reasons: ['Execution environment is SSR, not a browser runtime.'],
    };
  }

  // 1. WebAssembly support
  const webAssemblySupported = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  if (!webAssemblySupported) {
    reasons.push('WebAssembly is not supported by this browser.');
  }

  // 2. Web Workers support
  const webWorkersSupported = typeof Worker !== 'undefined';
  if (!webWorkersSupported) {
    reasons.push('Web Workers are not supported.');
  }

  // 3. SharedArrayBuffer & Cross-Origin Isolation
  const crossOriginIsolated = Boolean(window.crossOriginIsolated);
  const sharedArrayBufferSupported = typeof SharedArrayBuffer !== 'undefined';

  // 4. Mobile Device Detection
  const userAgent = navigator.userAgent || '';
  const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

  // 5. Memory Estimation
  const navAny = navigator as any;
  let estimatedMemoryMB = 4096; // default 4GB baseline
  if (navAny.deviceMemory) {
    estimatedMemoryMB = navAny.deviceMemory * 1024;
  } else if (isMobileDevice) {
    estimatedMemoryMB = 2048; // default 2GB mobile baseline
  }

  // 6. Safe thresholds
  // Single-threaded ffmpeg.wasm in modern browsers has typical ~2GB heap upper bound.
  // Guardrails prevent crashes on mobile / constrained devices:
  const maxSafeInputBytes = isMobileDevice 
    ? 150 * 1024 * 1024    // 150 MB for mobile
    : 450 * 1024 * 1024;   // 450 MB for desktop

  const maxSafeDurationSeconds = isMobileDevice 
    ? 600                  // 10 minutes for mobile
    : 1800;                // 30 minutes for desktop

  const browserProcessingRecommended = webAssemblySupported && webWorkersSupported;

  if (browserProcessingRecommended) {
    reasons.push('Standard single-threaded WebAssembly execution is fully supported.');
    if (crossOriginIsolated) {
      reasons.push('Browser is cross-origin isolated with SharedArrayBuffer capability.');
    } else {
      reasons.push('Running in standard non-isolated mode (OAuth and CDN safe).');
    }
  }

  return {
    webAssemblySupported,
    webWorkersSupported,
    sharedArrayBufferSupported,
    crossOriginIsolated,
    isMobileDevice,
    estimatedMemoryMB,
    maxSafeInputBytes,
    maxSafeDurationSeconds,
    browserProcessingRecommended,
    reasons,
  };
}

/**
 * Validates whether a specific media request is safe for client-side processing
 */
export function isRequestSafeForBrowser(
  sizeBytes?: number, 
  durationSeconds?: number
): { safe: boolean; reason?: string } {
  const caps = detectBrowserCapabilities();

  if (!caps.browserProcessingRecommended) {
    return { safe: false, reason: caps.reasons.join('; ') };
  }

  if (sizeBytes && sizeBytes > caps.maxSafeInputBytes) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(0);
    const maxMB = (caps.maxSafeInputBytes / (1024 * 1024)).toFixed(0);
    return { 
      safe: false, 
      reason: `Media file size (${sizeMB}MB) exceeds browser safe limit (${maxMB}MB).` 
    };
  }

  if (durationSeconds && durationSeconds > caps.maxSafeDurationSeconds) {
    return { 
      safe: false, 
      reason: `Media duration (${Math.round(durationSeconds)}s) exceeds browser safe limit (${caps.maxSafeDurationSeconds}s).` 
    };
  }

  return { safe: true };
}
