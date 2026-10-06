/**
 * Intelligent Media Routing Decision Engine
 *
 * Implements capability-aware, upstream-aware routing between:
 * - Browser Processing (ffmpeg.wasm / MediaEngine)
 * - Server Pipeline (FastAPI -> Redis -> Celery -> FFmpeg)
 */
import { detectBrowserCapabilities, isRequestSafeForBrowser } from './capabilities';
import { MediaRoutingDecision, RoutingRecommendation } from './types';

export interface RouteEvaluationParams {
  mediaUrl: string;
  filesizeBytes?: number;
  durationSeconds?: number;
  targetFormat?: string;
  requiresReencoding?: boolean;
  serverUpstreamBlocked?: boolean;
  browserStreamAvailable?: boolean;
}

export function evaluateMediaRouting(params: RouteEvaluationParams): MediaRoutingDecision {
  const {
    mediaUrl,
    filesizeBytes,
    durationSeconds,
    requiresReencoding = false,
    serverUpstreamBlocked = false,
    browserStreamAvailable = false,
  } = params;

  const caps = detectBrowserCapabilities();
  const browserSafe = isRequestSafeForBrowser(filesizeBytes, durationSeconds);

  // 1. If browser lacks WebAssembly / Web Workers
  if (!caps.browserProcessingRecommended) {
    return {
      mode: 'SERVER_ONLY',
      reason: 'Client browser or device lacks WebAssembly capabilities. Routing to server pipeline.',
      browserSupported: false,
      serverSupported: true,
      estimatedBytes: filesizeBytes,
      sourceUrl: mediaUrl,
    };
  }

  // 2. If server extraction was blocked by upstream BotGuard/rate-limit
  if (serverUpstreamBlocked) {
    if (browserStreamAvailable && browserSafe.safe) {
      return {
        mode: 'BROWSER_ONLY',
        reason: 'Upstream server extraction rate-limited. Browser-accessible stream route available.',
        browserSupported: true,
        serverSupported: false,
        estimatedBytes: filesizeBytes,
        sourceUrl: mediaUrl,
      };
    }
    return {
      mode: 'UNSUPPORTED',
      reason: 'Upstream platform rate-limited server extraction and direct browser stream is unavailable.',
      browserSupported: false,
      serverSupported: false,
      sourceUrl: mediaUrl,
    };
  }

  // 3. Heavy / Oversized Media -> Server Routing
  if (!browserSafe.safe) {
    return {
      mode: 'SERVER_ONLY',
      reason: browserSafe.reason || 'Media size or duration exceeds safe browser limits. Routing to server.',
      browserSupported: false,
      serverSupported: true,
      estimatedBytes: filesizeBytes,
      sourceUrl: mediaUrl,
    };
  }

  // 4. Heavy re-encoding on mobile -> Server preferred
  if (requiresReencoding && caps.isMobileDevice && (durationSeconds || 0) > 180) {
    return {
      mode: 'RECOMMENDED_SERVER',
      reason: 'Complex media transcoding on mobile devices is optimized on the cloud server.',
      browserSupported: true,
      serverSupported: true,
      estimatedBytes: filesizeBytes,
      sourceUrl: mediaUrl,
    };
  }

  // 5. Small / Fast remux or direct stream -> Browser Preferred (Instant, zero cloud egress)
  if (filesizeBytes && filesizeBytes < 50 * 1024 * 1024 && !requiresReencoding) {
    return {
      mode: 'RECOMMENDED_BROWSER',
      reason: 'Lightweight media container remuxing executes instantly in browser with zero server egress.',
      browserSupported: true,
      serverSupported: true,
      estimatedBytes: filesizeBytes,
      sourceUrl: mediaUrl,
    };
  }

  // 6. Default balanced route
  return {
    mode: 'RECOMMENDED_BROWSER',
    reason: 'Browser-native media processing active with server fallback ready.',
    browserSupported: true,
    serverSupported: true,
    estimatedBytes: filesizeBytes,
    sourceUrl: mediaUrl,
  };
}
