/**
 * Extension Bridge for Vidleo NEXUS
 * Communicates with the Vidleo Companion Extension (MV3) to perform direct,
 * zero-transit media byte acquisition when web origin JavaScript is restricted by CORS.
 */

export interface ExtensionStatus {
  installed: boolean;
  version?: string;
  source: 'content_script' | 'runtime' | 'dom_attribute' | 'none';
  capabilities?: {
    playbackCapture?: boolean;
    captureStream?: boolean;
    ffmpegLocal?: boolean;
    zeroServerTransit?: boolean;
  };
}

export interface ExtensionAcquisitionOptions {
  streamUrl: string;
  targetFilename: string;
  expectedBytes?: number;
  mimeType?: string;
  signal?: AbortSignal;
  onProgress?: (progress: {
    percent: number;
    bytesReceived: number;
    totalBytes: number;
    speedFormatted?: string;
  }) => void;
}

export interface ExtensionAcquisitionResult {
  success: boolean;
  sessionId: string;
  filename: string;
  totalBytes: number;
  mimeType: string;
  blobUrl?: string;
  acquisitionSource: 'BROWSER_NETWORK';
}

// Timeout to detect extension via DOM markers and postMessage ping
export async function detectExtension(timeoutMs: number = 800): Promise<ExtensionStatus> {
  if (typeof window === 'undefined') {
    return { installed: false, source: 'none' };
  }

  // 1. Check window flag
  if ((window as any).__NEXUS_EXTENSION_INSTALLED__) {
    const version = (window as any).__NEXUS_EXTENSION_VERSION__ || '1.0.0';
    (window as any).__NEXUS_DIAGNOSTIC__ = {
      extensionInstalled: true,
      extensionReachable: true,
      handshakeStarted: true,
      handshakeSucceeded: true,
      extensionVersion: version,
      productionOriginAllowed: true,
      detectionSource: 'window_flag',
      lastChecked: Date.now(),
    };
    return {
      installed: true,
      version,
      source: 'content_script',
    };
  }

  // 2. Check DOM markers on documentElement (CSP-safe marker set by content script)
  if (typeof document !== 'undefined' && document.documentElement) {
    const isDomInstalled = document.documentElement.getAttribute('data-nexus-extension-installed') === 'true' ||
                           document.documentElement.dataset?.nexusExtensionInstalled === 'true';
    if (isDomInstalled) {
      const version = document.documentElement.getAttribute('data-nexus-extension-version') || 
                      document.documentElement.dataset?.nexusExtensionVersion || '1.0.0';
      (window as any).__NEXUS_EXTENSION_INSTALLED__ = true;
      (window as any).__NEXUS_EXTENSION_VERSION__ = version;
      (window as any).__NEXUS_DIAGNOSTIC__ = {
        extensionInstalled: true,
        extensionReachable: true,
        handshakeStarted: true,
        handshakeSucceeded: true,
        extensionVersion: version,
        productionOriginAllowed: true,
        detectionSource: 'dom_attribute',
        lastChecked: Date.now(),
      };
      return {
        installed: true,
        version,
        source: 'dom_attribute',
      };
    }
  }

  // 3. Perform active window.postMessage handshake with retry
  return new Promise((resolve) => {
    let resolved = false;
    let retryTimer: any = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (retryTimer) clearTimeout(retryTimer);
        window.removeEventListener('message', handleMessage);
        (window as any).__NEXUS_DIAGNOSTIC__ = {
          extensionInstalled: false,
          extensionReachable: false,
          handshakeStarted: true,
          handshakeSucceeded: false,
          productionOriginAllowed: true,
          lastError: 'Extension handshake timed out (no PONG response received within timeout)',
          lastChecked: Date.now(),
        };
        resolve({ installed: false, source: 'none' });
      }
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (event.data?.source === 'nexus-extension' && event.data?.type === 'PONG') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (retryTimer) clearTimeout(retryTimer);
          window.removeEventListener('message', handleMessage);
          const version = event.data.version || '1.0.0';
          (window as any).__NEXUS_EXTENSION_INSTALLED__ = true;
          (window as any).__NEXUS_EXTENSION_VERSION__ = version;
          (window as any).__NEXUS_DIAGNOSTIC__ = {
            extensionInstalled: true,
            extensionReachable: true,
            handshakeStarted: true,
            handshakeSucceeded: true,
            extensionVersion: version,
            productionOriginAllowed: true,
            detectionSource: 'post_message',
            capabilities: event.data.capabilities,
            lastChecked: Date.now(),
          };
          resolve({
            installed: true,
            version,
            source: 'content_script',
            capabilities: event.data.capabilities,
          });
        }
      }
    }

    window.addEventListener('message', handleMessage);
    // Primary ping
    window.postMessage({ source: 'nexus-webpage', type: 'PING' }, '*');
    // Fast follow-up retry after 150ms in case content script was attaching
    retryTimer = setTimeout(() => {
      if (!resolved) {
        window.postMessage({ source: 'nexus-webpage', type: 'PING' }, '*');
      }
    }, 150);
  });
}

/**
 * Executes direct media byte acquisition via the Vidleo MV3 extension offscreen document.
 */
export async function acquireViaExtension(
  options: ExtensionAcquisitionOptions
): Promise<ExtensionAcquisitionResult> {
  const { streamUrl, targetFilename, expectedBytes = 0, mimeType = 'video/mp4', signal, onProgress } = options;
  const sessionId = `ext-acq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Acquisition aborted by user.'));
      }
    };

    if (signal?.aborted) {
      return handleAbort();
    }
    if (signal) {
      signal.addEventListener('abort', handleAbort);
    }

    function handleMessage(event: MessageEvent) {
      if (!event.data || event.data.source !== 'nexus-extension') return;

      const { type, payload } = event.data;

      if (type === 'ACQUISITION_PROGRESS' && payload?.sessionId === sessionId) {
        if (onProgress) {
          onProgress({
            percent: payload.percent ?? 0,
            bytesReceived: payload.bytesReceived ?? 0,
            totalBytes: payload.totalBytes ?? expectedBytes,
            speedFormatted: payload.speedFormatted,
          });
        }
      } else if (type === 'ACQUISITION_COMPLETE' && payload?.sessionId === sessionId) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            success: true,
            sessionId,
            filename: payload.filename || targetFilename,
            totalBytes: payload.totalBytes,
            mimeType: payload.mimeType || mimeType,
            blobUrl: payload.blobUrl,
            acquisitionSource: 'BROWSER_NETWORK',
          });
        }
      } else if (type === 'ACQUISITION_FAILED' && payload?.sessionId === sessionId) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(payload.error || 'Extension acquisition failed.'));
        }
      }
    }

    window.addEventListener('message', handleMessage);

    // Dispatch start acquisition request to content script
    window.postMessage({
      source: 'nexus-webpage',
      type: 'START_DIRECT_ACQUISITION',
      payload: {
        sessionId,
        streamUrl,
        targetFilename,
        expectedBytes,
        mimeType,
      },
    }, '*');
  });
}

/**
 * Resolves media metadata directly via the Vidleo MV3 Extension using the user's browser network.
 * Bypasses server-side datacenter IP rate limits (HTTP 429/403).
 */
export async function resolveMediaViaExtension(url: string, timeoutMs: number = 6000): Promise<any> {
  const extStatus = await detectExtension(200);
  if (!extStatus.installed) {
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (!event.data || event.data.source !== 'nexus-extension') return;

      if (event.data.type === 'RESOLVE_MEDIA_SUCCESS') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(event.data.payload);
        }
      } else if (event.data.type === 'RESOLVE_MEDIA_ERROR') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      }
    }

    window.addEventListener('message', handleMessage);

    window.postMessage({
      source: 'nexus-webpage',
      type: 'RESOLVE_MEDIA',
      payload: { url },
    }, '*');
  });
}

export interface ExtensionPlaybackCaptureOptions {
  videoId?: string;
  videoUrl: string;
  mode?: 'demo_10s' | 'full_video';
  durationSeconds?: number;
  targetFilename?: string;
  onProgress?: (progress: {
    stage: string;
    recordedSeconds?: number;
    targetSeconds?: number;
    percent: number;
    bytesReceived?: number;
  }) => void;
}

export interface ExtensionPlaybackCaptureResult {
  success: boolean;
  sessionId: string;
  filename: string;
  captureBytes: number;
  captureSha256: string;
  ffmpegInputSha256: string;
  ffmpegOutputSha256: string;
  outputBytes: number;
  outputDuration: number;
  outputWidth: number;
  outputHeight: number;
  videoTracksCount: number;
  audioTracksCount: number;
  blobUrl?: string;
  downloadStarted: boolean;
}

/**
 * Triggers in-browser YouTube playback capture via the Vidleo Companion Extension
 */
export async function startPlaybackCaptureViaExtension(
  options: ExtensionPlaybackCaptureOptions
): Promise<ExtensionPlaybackCaptureResult> {
  const extStatus = await detectExtension(800);
  if (!extStatus.installed) {
    throw new Error('Vidleo Companion Extension is required for browser playback capture. Please ensure the extension is loaded and enabled in Chrome.');
  }

  const sessionId = `playback-cap-${Date.now()}`;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
    };

    function handleMessage(event: MessageEvent) {
      if (!event.data || event.data.source !== 'nexus-extension') return;

      const { type, payload } = event.data;

      if (type === 'PLAYBACK_CAPTURE_PROGRESS') {
        if (payload?.sessionId === sessionId && options.onProgress) {
          options.onProgress({
            stage: payload.stage || 'recording',
            recordedSeconds: payload.recordedSeconds,
            targetSeconds: payload.targetSeconds,
            percent: payload.percent || 0,
            bytesReceived: payload.bytesReceived,
          });
        }
      } else if (type === 'PLAYBACK_CAPTURE_COMPLETE') {
        if (!settled && (payload?.sessionId === sessionId || !payload?.sessionId)) {
          settled = true;
          cleanup();
          resolve({
            success: true,
            sessionId,
            filename: payload.filename || options.targetFilename || 'video.webm',
            captureBytes: payload.captureBytes || 0,
            captureSha256: payload.captureSha256 || '',
            ffmpegInputSha256: payload.ffmpegInputSha256 || '',
            ffmpegOutputSha256: payload.ffmpegOutputSha256 || '',
            outputBytes: payload.outputBytes || 0,
            outputDuration: payload.outputDuration || 0,
            outputWidth: payload.outputWidth || 0,
            outputHeight: payload.outputHeight || 0,
            videoTracksCount: payload.videoTracksCount || 1,
            audioTracksCount: payload.audioTracksCount || 1,
            blobUrl: payload.blobUrl,
            downloadStarted: Boolean(payload.downloadStarted),
          });
        }
      } else if (type === 'PLAYBACK_CAPTURE_FAILED') {
        if (!settled && (payload?.sessionId === sessionId || !payload?.sessionId)) {
          settled = true;
          cleanup();
          reject(new Error(payload.error || 'Playback capture failed in extension'));
        }
      }
    }

    window.addEventListener('message', handleMessage);

    window.postMessage({
      source: 'nexus-webpage',
      type: 'START_PLAYBACK_CAPTURE',
      payload: {
        sessionId,
        videoId: options.videoId,
        videoUrl: options.videoUrl,
        mode: options.mode || 'demo_10s',
        durationSeconds: options.durationSeconds,
        targetFilename: options.targetFilename,
      },
    }, '*');
  });
}

export interface ExtensionCdpDownloadOptions {
  videoId?: string;
  videoUrl: string;
  targetFilename?: string;
  durationSeconds?: number;
  quality?: string;
  targetItag?: string | number;
  mode?: 'FULL' | 'DEMO';
  onProgress?: (progress: {
    state: string;
    percent: number;
    message: string;
    bytesAcquired?: number;
    videoBytes?: number;
    audioBytes?: number;
  }) => void;
}

export interface ExtensionCdpDownloadResult {
  success: boolean;
  sessionId: string;
  filename: string;
  totalBytes: number;
  rawUmpBytes: number;
  videoBytes: number;
  audioBytes: number;
  duration: number;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  sha256: string;
  requestId?: string;
  blobUrl?: string;
  downloadStarted: boolean;
  provenance: 'CDP_ACTIVE_PLAYER_MEDIA_RESPONSE_BODY';
}

/**
 * Triggers actual media byte acquisition via Chrome DevTools Protocol in Vidleo Companion Extension
 */
export async function startCdpMediaDownloadViaExtension(
  options: ExtensionCdpDownloadOptions
): Promise<ExtensionCdpDownloadResult> {
  const extStatus = await detectExtension(800);
  if (!extStatus.installed) {
    throw new Error('Vidleo Companion Extension is required for browser media acquisition. Please ensure the extension is loaded and enabled in Chrome.');
  }

  const sessionId = `cdp-acq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestId = `cdp-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expectedSeconds = Number(options.durationSeconds || 0);
  const bridgeTimeoutMs = Math.max(360000, expectedSeconds > 0 ? expectedSeconds * 2000 + 120000 : 420000);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: number;

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
    };

    timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`CDP media acquisition timed out after ${Math.round(bridgeTimeoutMs / 1000)}s without a terminal result`));
    }, bridgeTimeoutMs);

    function handleMessage(event: MessageEvent) {
      if (!event.data || event.data.source !== 'nexus-extension') return;

      const { type, payload } = event.data;

      if (type === 'NEXUS_CDP_PROGRESS') {
        if (payload?.sessionId === sessionId && options.onProgress) {
          options.onProgress({
            state: payload.state || 'WORKING',
            percent: payload.percent || 0,
            message: payload.message || 'Processing...',
            bytesAcquired: payload.bytesAcquired,
            videoBytes: payload.videoBytes,
            audioBytes: payload.audioBytes,
          });
        }
      } else if (type === 'CDP_MEDIA_DOWNLOAD_SUCCESS' || type === 'NEXUS_CDP_RESULT') {
        if (!settled && payload?.sessionId === sessionId && (!payload?.requestId || payload.requestId === requestId)) {
          settled = true;
          cleanup();
          resolve(payload);
        }
      } else if (type === 'CDP_MEDIA_DOWNLOAD_ERROR' || type === 'NEXUS_CDP_ERROR') {
        if (!settled && payload?.sessionId === sessionId && (!payload?.requestId || payload.requestId === requestId)) {
          settled = true;
          cleanup();
          reject(new Error(`[${payload?.code || 'CDP_DOWNLOAD_FAILED'}] ${payload?.message || payload?.error || 'CDP media acquisition failed in extension'}`));
        }
      } else if (type === 'EXTENSION_MESSAGE_CHANNEL_ERROR') {
        if (!settled && payload?.sessionId === sessionId && (!payload?.requestId || payload.requestId === requestId)) {
          settled = true;
          cleanup();
          reject(new Error(`[EXTENSION_MESSAGE_CHANNEL_ERROR] ${payload?.message || payload?.error || 'Extension message channel failed'}`));
        }
      }
    }

    window.addEventListener('message', handleMessage);

    window.postMessage({
        source: 'nexus-webpage',
        type: 'NEXUS_CDP_DOWNLOAD_START',
        payload: {
        requestId,
          sessionId,
        videoId: options.videoId,
        videoUrl: options.videoUrl,
        targetFilename: options.targetFilename,
        durationSeconds: options.durationSeconds,
        quality: options.quality,
        targetItag: options.targetItag,
        mode: options.mode || 'FULL',
      },
    }, '*');
  });
}
