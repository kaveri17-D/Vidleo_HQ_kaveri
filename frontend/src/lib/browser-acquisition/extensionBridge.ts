/**
 * Extension Bridge for Vidleo NEXUS
 * Communicates with the Vidleo Companion Extension (MV3) to perform direct,
 * zero-transit media byte acquisition when web origin JavaScript is restricted by CORS.
 */

export interface ExtensionStatus {
  installed: boolean;
  version?: string;
  source: 'content_script' | 'runtime' | 'none';
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

// Timeout to detect extension via postMessage ping
export async function detectExtension(timeoutMs: number = 300): Promise<ExtensionStatus> {
  if (typeof window === 'undefined') {
    return { installed: false, source: 'none' };
  }

  // Check window flag injected by content script
  if ((window as any).__NEXUS_EXTENSION_INSTALLED__) {
    return {
      installed: true,
      version: (window as any).__NEXUS_EXTENSION_VERSION__ || '1.0.0',
      source: 'content_script',
    };
  }

  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener('message', handleMessage);
        resolve({ installed: false, source: 'none' });
      }
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (event.data?.source === 'nexus-extension' && event.data?.type === 'PONG') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          window.removeEventListener('message', handleMessage);
          (window as any).__NEXUS_EXTENSION_INSTALLED__ = true;
          resolve({
            installed: true,
            version: event.data.version || '1.0.0',
            source: 'content_script',
          });
        }
      }
    }

    window.addEventListener('message', handleMessage);
    window.postMessage({ source: 'nexus-webpage', type: 'PING' }, '*');
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
  const extStatus = await detectExtension(300);
  if (!extStatus.installed) {
    throw new Error('Vidleo Companion Extension is required for browser playback capture');
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

